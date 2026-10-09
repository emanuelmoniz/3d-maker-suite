import {
  type ExternalPrint,
  type IntegrationAdapter,
  IntegrationError,
  type LibrarySpool,
  type Logger,
} from "@3d-maker-suite/core";
import { z } from "zod";

export { bambuStudioLibrary } from "./studio.ts";

import { call, cookie, parse, REGIONS, type Region, URLS } from "./cloud.ts";
import { bambuStudioLibrary } from "./studio.ts";

const configSchema = z.object({ region: z.enum(REGIONS).default("global") });
// Optional so the integration can exist before the user signs in. The password is never stored,
// and there is no refresh: the upstream refresh endpoint only answers 401, so an expired token
// (about every 3 months) shows up as `auth_expired` and the user signs in again.
const secretsSchema = z.object({ token: z.string().min(1).optional() });

const loginResponse = z.object({
  accessToken: z.string().optional(),
  loginType: z.string().optional(),
  tfaKey: z.string().optional(),
});
// Unknown keys are dropped, so the LAN access code (`dev_access_code`) never leaves this file.
const bindResponse = z.object({
  devices: z.array(
    z.object({
      dev_id: z.string().min(1),
      name: z.string().nullish(),
      dev_product_name: z.string(),
      nozzle_diameter: z.union([z.string(), z.number()]).nullish(),
    }),
  ),
});
// Task history (OpenBambuAPI cloud-http.md). Only what we need is required, so a harmless extra or
// missing field doesn't break the sync; a missing id/status/time/device is `api_changed`.
const PAGE = 20;
const tasksResponse = z.object({
  hits: z.array(
    z.object({
      id: z.number(),
      title: z.string().nullish(),
      designTitle: z.string().nullish(),
      designId: z.number().nullish(),
      status: z.number(), // 2 = finished, 3 = failed/aborted; anything else is skipped
      startTime: z.string(),
      endTime: z.string().nullish(),
      costTime: z.number().nullish(), // the slicer's estimate, not the real duration
      weight: z.number().nullish(),
      cover: z.string().nullish(),
      deviceId: z.string(),
      amsDetailMapping: z
        .array(
          z.object({
            ams: z.number().nullish(),
            filamentType: z.string().nullish(),
            targetColor: z.string().nullish(), // the tray actually used, as RRGGBBAA
            weight: z.number(),
          }),
        )
        .nullish(),
    }),
  ),
});
type Task = z.infer<typeof tasksResponse>["hits"][number];

const OUTCOMES: Record<number, ExternalPrint["outcome"]> = { 2: "success", 3: "failed" };

function toPrint(t: Task, region: Region, log: Logger): ExternalPrint | undefined {
  const outcome = OUTCOMES[t.status];
  const start = Date.parse(t.startTime);
  if (!outcome || Number.isNaN(start)) {
    log.debug({ status: t.status }, "bambu task skipped"); // e.g. still printing
    return;
  }
  const end = t.endTime ? Date.parse(t.endTime) : Number.NaN;
  const durationSec = end > start ? Math.round((end - start) / 1000) : undefined;
  // ponytail: the cloud only has the sliced weight. A failed print is scaled by how far it got
  // (time ratio); a rough guess the user can correct on the print. Add real data if Bambu ever sends it.
  const done =
    outcome === "failed" && durationSec && t.costTime ? Math.min(1, durationSec / t.costTime) : 1;
  const rgb = (c?: string | null) =>
    c && /^[0-9a-f]{6}/i.test(c) ? `#${c.slice(0, 6)}` : undefined;
  const mapped = (t.amsDetailMapping ?? []).map((m) => ({
    slot: m.ams != null && m.ams >= 0 ? m.ams : undefined,
    material: m.filamentType || undefined,
    colorHex: rgb(m.targetColor),
    grams: Math.round(m.weight * done * 100) / 100,
  }));
  const filaments =
    mapped.length || !t.weight ? mapped : [{ grams: Math.round(t.weight * done * 100) / 100 }];
  const host = region === "china" ? "makerworld.com.cn" : "makerworld.com";
  return {
    externalId: String(t.id),
    printerExternalId: t.deviceId,
    title: t.title || t.designTitle || `Task ${t.id}`,
    startedAt: new Date(start).toISOString(),
    durationSec,
    outcome,
    filaments,
    coverUrl: t.cover || undefined,
    sourceUrl: t.designId ? `https://${host}/models/${t.designId}` : undefined,
  };
}

// The filament manager of Bambu Studio / Handy. The cloud is the source of truth: Studio's local
// copy (filament_inventory/spools.json) can drift from it (BambuStudio#10766).
// Fields per Studio's fila_manager sources; `status` 0 = active, 1 = info needed (both listed).
const SPOOL_PAGE = 100;
// No `total` in the response: a short page is the last one.
const spoolsResponse = z.object({
  hits: z.array(
    z.object({
      id: z.number(),
      filamentVendor: z.string().nullish(),
      filamentType: z.string().nullish(),
      filamentName: z.string().nullish(),
      color: z.string().nullish(), // #RRGGBBAA
      netWeight: z.number().nullish(), // grams left
      totalNetWeight: z.number().nullish(), // grams on a full spool
    }),
  ),
});

export function toSpool(
  s: z.infer<typeof spoolsResponse>["hits"][number],
): LibrarySpool | undefined {
  const material = s.filamentType?.trim();
  if (!material) return;
  const color = s.color ?? "";
  const initialGrams = s.totalNetWeight && s.totalNetWeight > 0 ? s.totalNetWeight : 1000;
  const remainingGrams = Math.min(Math.max(s.netWeight ?? 0, 0), initialGrams);
  return {
    spoolId: String(s.id),
    profile: { brand: s.filamentVendor ?? "", material, name: s.filamentName || material },
    colorHex: /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7).toLowerCase() : "#808080",
    initialGrams,
    remainingGrams,
    emptyWeightGrams: null, // the cloud doesn't keep the empty spool's weight
    status: remainingGrams <= 0 ? "empty" : remainingGrams >= initialGrams ? "new" : "in_use",
  };
}

type LoginState = { email?: string; tfaKey?: string };

export function bambuCloudAdapter(): IntegrationAdapter {
  return {
    // The id predates Bambu Studio joining; it stays so stored rows and spool sources keep matching.
    id: "bambu-cloud",
    capabilities: ["printers", "prints", "spools", "filamentProfiles", "openInSlicer"],
    library: bambuStudioLibrary(),
    configSchema,
    secretsSchema,

    async login({ config, log, signal }, input) {
      const { region } = config as { region: Region };
      const base = { region, log, signal };
      // Wrong credentials or codes come back as 400/401/403 JSON.
      const attempt = (url: string, body: unknown, headers?: Record<string, string>) =>
        call(url, { ...base, body, headers, expect: [400, 401, 403] });

      if ("password" in input) {
        const res = await attempt(URLS.login, {
          account: input.email,
          password: input.password,
          apiError: "",
        });
        if (!res.ok) throw new IntegrationError("login_failed");
        const r = await parse(res, loginResponse, log);
        if (r.accessToken) return { secrets: { token: r.accessToken } };
        if (r.loginType === "verifyCode") {
          await call(URLS.emailCode, { ...base, body: { email: input.email, type: "codeLogin" } });
          return { challenge: "email_code", state: JSON.stringify({ email: input.email }) };
        }
        if (r.loginType === "tfa" && r.tfaKey)
          return { challenge: "totp", state: JSON.stringify({ tfaKey: r.tfaKey }) };
        throw new IntegrationError("api_changed");
      }

      const state = JSON.parse(input.state) as LoginState;
      if (state.tfaKey) {
        // The 2FA step lives on the website and wants its CSRF cookie echoed as a header.
        const csrf = cookie(await call(URLS.csrf, base), "bbl_csrf_token");
        if (!csrf) throw new IntegrationError("api_changed");
        const res = await attempt(
          URLS.tfaLogin,
          { tfaKey: state.tfaKey, tfaCode: input.code },
          { "x-bbl-csrf-token": csrf, cookie: `bbl_csrf_token=${csrf}` },
        );
        const token = res.ok ? cookie(res, "token") : undefined;
        if (!token) throw new IntegrationError("code_invalid");
        return { secrets: { token } };
      }
      const res = await attempt(URLS.login, { account: state.email, code: input.code });
      const token = res.ok ? (await parse(res, loginResponse, log)).accessToken : undefined;
      if (!token) throw new IntegrationError("code_invalid");
      return { secrets: { token } };
    },

    create: ({ config, secrets, log, signal }) => {
      const { region } = config as { region: Region };
      const authed = async (url: string) => {
        const token = await secrets.get("token");
        if (!token) throw new IntegrationError("auth_required");
        return call(url, { region, log, signal, token });
      };
      const devices = async () => (await parse(await authed(URLS.bind), bindResponse, log)).devices;
      return {
        // Thrown errors become a failed TestResult in the server.
        test: async () => {
          await devices();
          return { ok: true };
        },
        printers: {
          listPrinters: async () =>
            (await devices()).map((d) => ({
              externalId: d.dev_id,
              serial: d.dev_id,
              name: d.name || d.dev_id,
              brand: "Bambu Lab",
              model: d.dev_product_name,
              nozzleDiameterMm: Number(d.nozzle_diameter) || undefined,
            })),
        },
        printHistory: {
          // Newest first; `after` is the id of the last task of the previous page.
          listPrints: async ({ since, until, cursor }) => {
            const query = new URLSearchParams({ limit: String(PAGE) });
            if (cursor) query.set("after", cursor);
            const { hits } = await parse(
              await authed(`${URLS.tasks}?${query}`),
              tasksResponse,
              log,
            );
            const last = hits.at(-1);
            const older = last && since && Date.parse(last.startTime) < Date.parse(since);
            return {
              items: hits
                .map((t) => toPrint(t, region, log))
                .filter(
                  (p): p is ExternalPrint =>
                    !!p && (!since || p.startedAt >= since) && (!until || p.startedAt <= until),
                ),
              nextCursor: hits.length === PAGE && last && !older ? String(last.id) : undefined,
            };
          },
        },
        spools: {
          listSpools: async () => {
            const out: LibrarySpool[] = [];
            // ponytail: capped at 50 pages (5000 spools) in case paging never ends.
            for (let page = 0; page < 50; page++) {
              const query = new URLSearchParams({
                offset: String(page * SPOOL_PAGE),
                limit: String(SPOOL_PAGE),
              });
              const { hits } = await parse(
                await authed(`${URLS.spools}?${query}`),
                spoolsResponse,
                log,
              );
              for (const h of hits) {
                const s = toSpool(h);
                if (s) out.push(s);
              }
              if (hits.length < SPOOL_PAGE) break;
            }
            return out;
          },
        },
      };
    },
  };
}
