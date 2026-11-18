import {
  type IntegrationAdapter,
  type IntegrationContext,
  IntegrationError,
  type Logger,
} from "@3d-maker-suite/core";
import { z } from "zod";
import {
  historyListSchema,
  type JobInfo,
  metadataSchema,
  PRINTER_ID,
  RUNNING,
  STATUS_QUERY,
  type Status,
  statusSchema,
  toPrint,
  toSnapshot,
} from "./map.ts";

export { PRINTER_ID } from "./map.ts";

// Moonraker, the API of Klipper printers (ADR-0015): Voron, RatRig, Sovol, Qidi, Elegoo Neptune 4,
// rooted Creality... Read-only, over plain HTTP: status, history and the active Spoolman spool.
// Nothing here sends a command to the printer. A raw answer is never logged: paths and codes only.

const REQUEST_MS = 5_000;
const PAGE = 50;

export const moonrakerConfigSchema = z.object({
  /** "192.168.1.50", "voron.local:7125" or "http://...": Mainsail's or Fluidd's address works too. */
  host: z.string().trim().min(1).max(255),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  /**
   * Moonraker's `[spoolman]` points at another Spoolman than the app's: the spool it names isn't
   * one the app imported, and the app's Spoolman wasn't charged, so its prints are written back.
   */
  otherSpoolman: z.boolean().optional(),
});
type Config = z.infer<typeof moonrakerConfigSchema>;

/** Only needed when Moonraker's `[authorization]` doesn't trust this server's address. */
export const moonrakerSecretsSchema = z.object({ apiKey: z.string().optional() });

/** The base URL: http:// unless the host says otherwise, no trailing slash. */
export const baseUrl = (host: string) =>
  (/^https?:\/\//i.test(host) ? host : `http://${host}`).replace(/\/+$/, "");

/** A request that may answer "not here" (a component Moonraker doesn't load): undefined. */
type Get = <T>(
  path: string,
  schema: z.ZodType<T>,
  opts?: { missing?: number[] },
) => Promise<T | undefined>;

function client(ctx: IntegrationContext): Get {
  const { config, secrets, log, signal } = ctx as IntegrationContext & { config: Config };
  const base = baseUrl(config.host);
  return async (path, schema, opts) => {
    const key = await secrets.get("apiKey");
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        headers: { accept: "application/json", ...(key && { "x-api-key": key }) },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_MS)]),
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      log.debug(
        { path: route(path), err: (err as Error).name, cause: cause?.code },
        "moonraker unreachable",
      );
      throw new IntegrationError("unreachable");
    }
    if (opts?.missing?.includes(res.status)) return undefined;
    if (!res.ok) {
      log.debug({ path: route(path), status: res.status }, "moonraker request rejected");
      if (res.status === 401 || res.status === 403) throw new IntegrationError("auth_required");
      // 503: Klipper isn't connected to Moonraker.
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
    "unexpected moonraker response",
  );
  throw new IntegrationError("api_changed");
}

const printerInfo = z.object({ result: z.object({ hostname: z.string().nullish() }) });
const metadataAnswer = z.object({ result: metadataSchema });
const spoolAnswer = z.object({ result: z.object({ spool_id: z.number().nullish() }) });

export function moonrakerAdapter(): IntegrationAdapter {
  return {
    id: "moonraker",
    kind: "host",
    capabilities: ["printers", "prints", "printerStatus"],
    configSchema: moonrakerConfigSchema,
    secretsSchema: moonrakerSecretsSchema,
    create: (ctx) => {
      const config = ctx.config as Config;
      const get = client(ctx);
      const name = async () =>
        (await get("/printer/info", printerInfo))?.result.hostname || "Klipper";

      // The job the status shows: read once per job, not on every poll.
      let info: JobInfo | undefined;
      /** Moonraker has no history component: its job ids aren't there to wait for. */
      let noHistory = false;
      let wasRunning = false;

      async function jobInfo(file: string, running: boolean): Promise<JobInfo> {
        const out: JobInfo = { file };
        let newest: z.infer<typeof historyListSchema> | undefined;
        if (!noHistory)
          try {
            newest = await get("/server/history/list?limit=1&order=desc", historyListSchema, {
              missing: [404],
            });
            noHistory = !newest;
          } catch {
            // Read again on the next poll.
          }
        const job = newest?.result.jobs[0];
        // While it runs, only the job in progress is this one: a finished one of the same file is
        // the print before, until the history has the new one.
        if (job?.filename === file && (!running || job.status === "in_progress")) {
          out.jobId = job.job_id;
          out.startTime = job.start_time;
          out.meta = job.metadata ?? undefined;
        }
        out.meta ??= (
          await get(`/server/files/metadata?filename=${encodeURIComponent(file)}`, metadataAnswer, {
            missing: [404],
          }).catch(() => undefined)
        )?.result;
        const spool = await get("/server/spoolman/spool_id", spoolAnswer, {
          missing: [400, 404, 503],
        }).catch(() => undefined);
        if (spool?.result.spool_id != null) out.spoolId = spool.result.spool_id;
        return out;
      }

      return {
        test: async () => {
          try {
            await get("/server/info", z.object({ result: z.object({}) }));
            return { ok: true };
          } catch (e) {
            return { ok: false, code: e instanceof IntegrationError ? e.code : "unknown" };
          }
        },
        profile: async () => ({ name: await name() }),
        printers: {
          listPrinters: async () => {
            // The model the slicer named in the newest job, when the setup has none.
            const newest = config.model
              ? undefined
              : await get("/server/history/list?limit=1&order=desc", historyListSchema, {
                  missing: [404],
                });
            return [
              {
                externalId: PRINTER_ID,
                name: await name(),
                brand: config.brand || "Klipper",
                model: config.model || newest?.result.jobs[0]?.metadata?.printer_model || "",
              },
            ];
          },
        },
        printHistory: {
          listPrints: async ({ since, until, cursor }) => {
            const start = Number(cursor ?? 0);
            const q = new URLSearchParams({
              limit: String(PAGE),
              start: String(start),
              order: "desc",
            });
            if (since) q.set("since", String(Date.parse(since) / 1000));
            if (until) q.set("before", String(Date.parse(until) / 1000));
            const page = await get(`/server/history/list?${q}`, historyListSchema);
            if (!page) return { items: [] };
            const { jobs, count } = page.result;
            return {
              items: jobs
                .filter((j) => j.status !== "in_progress")
                .map((j) => toPrint(j, config.otherSpoolman)),
              nextCursor:
                jobs.length && start + jobs.length < count
                  ? String(start + jobs.length)
                  : undefined,
            };
          },
        },
        status: {
          readStatus: async () => {
            const at = new Date().toISOString();
            let status: Status;
            try {
              status =
                (await get(`/printer/objects/query?${STATUS_QUERY}`, statusSchema))?.result
                  .status ?? {};
            } catch (e) {
              // A printer that doesn't answer is offline; a wrong key is the source's failure.
              if (e instanceof IntegrationError && e.code === "unreachable")
                return [{ printerExternalId: PRINTER_ID, at, state: "offline", slots: [] }];
              throw e;
            }
            const ps = status.print_stats;
            const file = ps?.filename || undefined;
            const running = RUNNING.has(ps?.state ?? "");
            // A new file, a new start, or a job id the history didn't have yet.
            const stale =
              !info ||
              info.file !== file ||
              (running && !wasRunning) ||
              (running && !info.jobId && !noHistory);
            if (file && ps?.state !== "standby" && stale) {
              try {
                info = await jobInfo(file, running);
              } catch {
                info = undefined;
              }
            }
            wasRunning = running;
            return [toSnapshot(status, at, info, config.otherSpoolman)];
          },
        },
      };
    },
  };
}
