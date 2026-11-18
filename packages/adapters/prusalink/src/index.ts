import { type JobTotal, readJobTotals } from "@3d-maker-suite/3mf";
import {
  type IntegrationAdapter,
  type IntegrationContext,
  IntegrationError,
  type Logger,
} from "@3d-maker-suite/core";
import { z } from "zod";
import { authorize, type Challenge, parseChallenge } from "./digest.ts";
import {
  infoSchema,
  type JobInfo,
  jobSchema,
  legacyPrinterSchema,
  PRINTER_ID,
  RUNNING,
  statusSchema,
  toSnapshot,
} from "./map.ts";

export { PRINTER_ID } from "./map.ts";

// PrusaLink (ADR-0015): the local API of Prusa printers (MK4/S, Core One, XL, MINI, MK3 on a Pi).
// Read-only, over HTTP: live status, the job's file and its grams. No push, no history: a print is
// recorded when the status shows it end. Nothing here sends a command to the printer. A raw answer
// is never logged: paths and codes only.
// NOT confirmed on a printer: the payloads in fixtures/ are others' (fixtures/SOURCE.md).

const REQUEST_MS = 5_000;
/** The file is read as its first and last 64 KB: where the slicers keep the totals. */
const WINDOW = 64 * 1024;
/** A file that can't be read is tried again on later polls, this many times per job. */
const FILE_TRIES = 3;

export const prusalinkConfigSchema = z.object({
  /** "192.168.1.60", "prusa-mk4.local" or "http://...". */
  host: z.string().trim().min(1).max(255),
  model: z.string().trim().max(100).optional(),
  /** The Digest user; PrusaLink's own is `maker`. */
  username: z.string().trim().max(100).optional(),
});
type Config = z.infer<typeof prusalinkConfigSchema>;

/** Either the password (Digest) or an API key: the printer's settings show both. */
export const prusalinkSecretsSchema = z.object({
  password: z.string().optional(),
  apiKey: z.string().optional(),
});

/** The base URL: http:// unless the host says otherwise, no trailing slash. */
export const baseUrl = (host: string) =>
  (/^https?:\/\//i.test(host) ? host : `http://${host}`).replace(/\/+$/, "");

const route = (path: string) => path.split("?")[0];

type Get = (path: string, headers?: Record<string, string>) => Promise<Response>;

/** A request signed in as the setup says: Digest (a challenge, then answered), or the API key. */
function client(ctx: IntegrationContext): Get {
  const { config, secrets, log, signal } = ctx as IntegrationContext & { config: Config };
  const base = baseUrl(config.host);
  let challenge: Challenge | undefined;
  let nc = 0;

  const send = async (path: string, headers: Record<string, string>) => {
    try {
      return await fetch(`${base}${path}`, {
        headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_MS)]),
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      log.debug(
        { path: route(path), err: (err as Error).name, cause: cause?.code },
        "prusalink unreachable",
      );
      throw new IntegrationError("unreachable");
    }
  };

  return async (path, extra) => {
    const key = await secrets.get("apiKey");
    const password = await secrets.get("password");
    const headers: Record<string, string> = {
      accept: "application/json",
      ...(key && { "x-api-key": key }),
      ...extra,
    };
    const user = config.username || "maker";
    const signed = () =>
      challenge && password !== undefined
        ? { ...headers, authorization: authorize(challenge, user, password, "GET", path, ++nc) }
        : headers;
    let res = await send(path, signed());
    if (res.status === 401 && password !== undefined) {
      const next = parseChallenge(res.headers.get("www-authenticate"));
      if (next) {
        challenge = next;
        nc = 0;
        await res.body?.cancel();
        res = await send(path, signed());
      }
    }
    if (res.status === 401 || res.status === 403) {
      log.debug({ path: route(path), status: res.status }, "prusalink sign-in refused");
      await res.body?.cancel();
      throw new IntegrationError("auth_required");
    }
    return res;
  };
}

/** The JSON answer; undefined for "no job" (204) or a path this firmware doesn't have (404). */
async function getJson<T>(
  get: Get,
  log: Logger,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const res = await get(path);
  if (res.status === 204 || res.status === 404) {
    await res.body?.cancel();
    return undefined;
  }
  if (!res.ok) {
    log.debug({ path: route(path), status: res.status }, "prusalink request rejected");
    await res.body?.cancel();
    throw new IntegrationError(res.status >= 500 ? "unreachable" : "api_changed");
  }
  const r = schema.safeParse(await res.json().catch(() => undefined));
  if (r.success) return r.data;
  log.warn(
    { path: route(path), issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) },
    "unexpected prusalink response",
  );
  throw new IntegrationError("api_changed");
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/**
 * The slicer totals of the job file. A `.bgcode` has them in its first block, so only the head is
 * asked for; a text G-code has them at the end, so the tail is asked for by range. A printer that
 * ignores `Range` sends the whole file: it is read as a stream, keeping the head and a rolling tail
 * (a `.bgcode` is cut off after its head).
 */
async function readTotals(get: Get, path: string, size?: number): Promise<JobTotal[]> {
  // The printer shortens a name to 8.3 (`TabletStand3~4.BGC`): the link may end in `.BGC`.
  const binary = /\.bgc(ode)?$/i.test(path);
  const range = binary || !size ? `bytes=0-${WINDOW - 1}` : `bytes=${Math.max(0, size - WINDOW)}-`;
  const res = await get(path, { range });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new IntegrationError("api_changed");
  }
  let head: Uint8Array = new Uint8Array();
  let tail: Uint8Array = new Uint8Array();
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (head.length < WINDOW) head = concat(head, value.subarray(0, WINDOW - head.length));
      if (binary && head.length >= WINDOW) break;
      tail = concat(tail, value);
      if (tail.length > WINDOW) tail = tail.subarray(tail.length - WINDOW);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return readJobTotals(binary || total <= WINDOW ? head : concat(head, tail));
}

export function prusalinkAdapter(): IntegrationAdapter {
  return {
    id: "prusalink",
    kind: "host",
    capabilities: ["printers", "printerStatus"],
    configSchema: prusalinkConfigSchema,
    secretsSchema: prusalinkSecretsSchema,
    create: (ctx) => {
      const config = ctx.config as Config;
      const get = client(ctx);
      const json = <T>(path: string, schema: z.ZodType<T>) => getJson(get, ctx.log, path, schema);
      const hostName = async () => (await json("/api/v1/info", infoSchema))?.hostname;

      // The job the status shows: read once per job id, not on every poll.
      let info: JobInfo | undefined;
      let fileTries = 0;

      async function jobInfo(id: number): Promise<JobInfo> {
        const out: JobInfo = { id };
        const job = await json("/api/v1/job", jobSchema);
        if (job?.id === id && job.file) {
          out.file = job.file.display_name || job.file.name;
          out.download = job.file.refs?.download ?? undefined;
          out.size = job.file.size ?? undefined;
        }
        // The loaded material is on the legacy path only; best effort.
        const legacy = await json("/api/printer", legacyPrinterSchema).catch(() => undefined);
        out.material = legacy?.telemetry?.material ?? undefined;
        return out;
      }

      async function readFile(i: JobInfo) {
        if (i.totals || !i.download || fileTries >= FILE_TRIES) return;
        fileTries++;
        try {
          i.totals = await readTotals(get, i.download, i.size);
        } catch (e) {
          ctx.log.debug(
            { tries: fileTries, code: e instanceof IntegrationError ? e.code : "unknown" },
            "prusalink job file not read",
          );
        }
      }

      const offline = (at: string) => [
        { printerExternalId: PRINTER_ID, at, state: "offline" as const, slots: [] },
      ];

      return {
        test: async () => {
          try {
            await json("/api/v1/status", statusSchema);
            return { ok: true };
          } catch (e) {
            return { ok: false, code: e instanceof IntegrationError ? e.code : "unknown" };
          }
        },
        profile: async () => ({ name: (await hostName()) || "Prusa" }),
        printers: {
          listPrinters: async () => {
            const i = await json("/api/v1/info", infoSchema);
            return [
              {
                externalId: PRINTER_ID,
                name: i?.hostname || "Prusa",
                brand: "Prusa",
                model: config.model || "",
                ...(i?.serial && { serial: i.serial }),
                ...(i?.nozzle_diameter && { nozzleDiameterMm: i.nozzle_diameter }),
              },
            ];
          },
        },
        status: {
          readStatus: async () => {
            const at = new Date().toISOString();
            let status: z.infer<typeof statusSchema> | undefined;
            try {
              status = await json("/api/v1/status", statusSchema);
            } catch (e) {
              // A printer that doesn't answer is offline; a wrong password is the source's failure.
              if (e instanceof IntegrationError && e.code === "unreachable") return offline(at);
              throw e;
            }
            if (!status) return offline(at);
            const id = status.job?.id;
            if (id != null && RUNNING.has(status.printer.state)) {
              // A new job, or one whose file wasn't named yet.
              if (info?.id !== id || !info.file) {
                if (info?.id !== id) fileTries = 0;
                info = await jobInfo(id).catch(() => ({ id }));
              }
              await readFile(info);
            }
            return [toSnapshot(status, at, info)];
          },
        },
      };
    },
  };
}
