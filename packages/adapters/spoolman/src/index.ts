import {
  type IntegrationAdapter,
  type IntegrationContext,
  IntegrationError,
  type Logger,
  type SpoolToCreate,
} from "@3d-maker-suite/core";
import { z } from "zod";
import {
  FIELD,
  fieldSchema,
  filamentSchema,
  findFilament,
  hex,
  markerOf,
  markerValue,
  spoolSchema,
  toLibrarySpool,
  vendorSchema,
  withCharge,
} from "./map.ts";

export { FIELD, markerOf } from "./map.ts";

// Spoolman (ADR-0015), two-way: its spools are imported (the usual review), and what each print
// took is written back to the spool it came from (`spoolUsage`). Spoolman has no idempotency keys,
// so a write never uses `/use`: it sets the spool's used weight and, in the same request, a marker
// field with the grams it holds per print slot. A retry reads the marker and sees what landed.
// A raw answer is never logged: paths and codes only.
// Confirmed against Spoolman 0.27.1 (fixtures/SOURCE.md).

const REQUEST_MS = 5_000;
/** The filament diameter of a spool the app makes there; the app's spools don't keep one. */
const DIAMETER_MM = 1.75;
/** PLA's, for a material whose density the app doesn't know. */
const DENSITY = 1.24;

export const spoolmanConfigSchema = z.object({
  /** "192.168.1.60:7912" or "http://...". */
  host: z.string().trim().min(1).max(255),
  /** A name for its card and its machine's page; unset = "Spoolman account". */
  name: z.string().trim().max(100).optional(),
});
type Config = z.infer<typeof spoolmanConfigSchema>;

/** Spoolman has no sign-in; a key only for a reverse proxy in front of it (`x-api-key`). */
export const spoolmanSecretsSchema = z.object({ apiKey: z.string().optional() });

/** The API's base URL: http:// unless the host says otherwise, no trailing slash. */
export const baseUrl = (host: string) =>
  `${(/^https?:\/\//i.test(host) ? host : `http://${host}`).replace(/\/+$/, "")}/api/v1`;

type Request = <T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
) => Promise<T | undefined>;

/** A request; 404 answers undefined (no such spool). */
function client(ctx: IntegrationContext): Request {
  const { config, secrets, log, signal } = ctx as IntegrationContext & { config: Config };
  const base = baseUrl(config.host);
  return async (method, path, schema, body) => {
    const key = await secrets.get("apiKey");
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(key && { "x-api-key": key }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_MS)]),
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      log.debug(
        { method, path: route(path), err: (err as Error).name, cause: cause?.code },
        "spoolman unreachable",
      );
      throw new IntegrationError("unreachable");
    }
    if (res.status === 404) return undefined;
    if (!res.ok) {
      log.debug({ method, path: route(path), status: res.status }, "spoolman request rejected");
      if (res.status === 401 || res.status === 403) throw new IntegrationError("auth_required");
      throw new IntegrationError(res.status >= 500 ? "unreachable" : "api_changed");
    }
    return parse(await res.json().catch(() => undefined), schema, path, log);
  };
}

/** The path without its query, for the log. */
const route = (path: string) => path.split("?")[0];

function parse<T>(body: unknown, schema: z.ZodType<T>, path: string, log: Logger): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  log.warn(
    { path: route(path), issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) },
    "unexpected spoolman response",
  );
  throw new IntegrationError("api_changed");
}

const infoSchema = z.object({ version: z.string() });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function spoolmanAdapter(): IntegrationAdapter {
  return {
    id: "spoolman",
    kind: "host",
    capabilities: ["spools", "spoolUsage"],
    configSchema: spoolmanConfigSchema,
    secretsSchema: spoolmanSecretsSchema,
    create: (ctx) => {
      const req = client(ctx);
      /** Must answer; a 404 here is not a Spoolman. */
      const need = async <T>(
        method: "GET" | "POST" | "PATCH",
        path: string,
        schema: z.ZodType<T>,
        body?: unknown,
      ): Promise<T> => {
        const out = await req(method, path, schema, body);
        if (out === undefined) throw new IntegrationError("api_changed");
        return out;
      };

      // Spoolman refuses an extra field it doesn't know: made once, the first time it's needed.
      let field: Promise<void> | undefined;
      const ensureField = () => {
        field ??= (async () => {
          const all = await need("GET", "/field/spool", z.array(fieldSchema));
          if (all.some((f) => f.key === FIELD)) return;
          await need("POST", `/field/spool/${FIELD}`, z.array(fieldSchema), {
            name: "3D Maker Suite",
            field_type: "text",
          });
        })().catch((e) => {
          field = undefined;
          throw e;
        });
        return field;
      };

      async function vendorFor(name: string | null) {
        if (!name?.trim()) return null;
        const all = await need("GET", "/vendor", z.array(vendorSchema));
        const found = all.find((v) => same(v.name, name));
        return found ?? (await need("POST", "/vendor", vendorSchema, { name: name.trim() }));
      }

      async function filamentFor(s: SpoolToCreate) {
        const vendor = await vendorFor(s.brand);
        const name = s.name?.trim() || s.colorName?.trim() || s.material;
        const all = await need("GET", "/filament", z.array(filamentSchema));
        const want = {
          vendorId: vendor?.id ?? null,
          material: s.material,
          name,
          colorHex: s.colorHex,
        };
        return (
          findFilament(all, want) ??
          (await need("POST", "/filament", filamentSchema, {
            name,
            ...(vendor && { vendor_id: vendor.id }),
            material: s.material,
            density: s.densityGcm3 ?? DENSITY,
            diameter: DIAMETER_MM,
            ...(s.initialGrams != null && { weight: s.initialGrams }),
            ...(s.emptyWeightGrams != null && { spool_weight: s.emptyWeightGrams }),
            color_hex: hex(s.colorHex).slice(1),
          }))
        );
      }

      return {
        test: async () => {
          try {
            await need("GET", "/info", infoSchema);
            return { ok: true };
          } catch (e) {
            return { ok: false, code: e instanceof IntegrationError ? e.code : "unknown" };
          }
        },
        spools: {
          listSpools: async () =>
            (await need("GET", "/spool", z.array(spoolSchema)))
              .filter((s) => !s.archived)
              .map(toLibrarySpool),
        },
        spoolUsage: {
          async writeUsage({ spoolId, key, grams, sent }) {
            await ensureField();
            const path = `/spool/${encodeURIComponent(spoolId)}`;
            const spool = await req("GET", path, spoolSchema);
            if (!spool) return { gone: true };
            const marker = markerOf(spool);
            // A key the marker no longer keeps (or never had: a print from before the link) holds
            // what the server last sent.
            const held = marker.charges[key] ?? sent;
            if (Math.abs(held - grams) < 0.005) return {};
            // One request: the weight and the marker that explains it land together, or neither.
            const done = await req("PATCH", path, spoolSchema, {
              used_weight: Math.max(0, spool.used_weight + grams - held),
              // Spoolman replaces all extra fields with what is sent: the others go back as they were.
              extra: { ...spool.extra, [FIELD]: markerValue(withCharge(marker, key, grams)) },
            });
            return done ? {} : { gone: true };
          },
          async createSpool(s) {
            await ensureField();
            // Made before, and the answer lost: that one.
            const all = await need("GET", "/spool?allow_archived=true", z.array(spoolSchema));
            const made = all.find((x) => markerOf(x).spool === s.appSpoolId);
            if (made) return { spoolId: String(made.id) };
            const filament = await filamentFor(s);
            const created = await need("POST", "/spool", spoolSchema, {
              filament_id: filament.id,
              ...(s.initialGrams != null && { initial_weight: s.initialGrams }),
              ...(s.emptyWeightGrams != null && { spool_weight: s.emptyWeightGrams }),
              ...(s.remainingGrams != null && { remaining_weight: s.remainingGrams }),
              extra: { [FIELD]: markerValue({ charges: {}, spool: s.appSpoolId }) },
            });
            return { spoolId: String(created.id) };
          },
        },
      };
    },
  };
}
