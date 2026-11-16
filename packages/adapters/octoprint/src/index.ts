import { type JobTotal, readJobTotals } from "@3d-maker-suite/3mf";
import {
  type IntegrationAdapter,
  type IntegrationContext,
  IntegrationError,
  type PrinterSnapshot,
} from "@3d-maker-suite/core";
import { z } from "zod";
import { createModel, type FileRef, PRINTER_ID, withTotals } from "./map.ts";

export { PRINTER_ID } from "./map.ts";

// OctoPrint (ADR-0015): the big base of Marlin printers, with or without a network of their own.
// Read-only: the push socket for status and the print's start and end, a ranged download of the job
// file for its grams. Nothing here sends a command to the printer. A raw answer is never logged:
// paths and codes only.
// Confirmed against OctoPrint 1.11.8 with its virtual printer (fixtures/SOURCE.md), not a real one.

const REQUEST_MS = 5_000;
const FILE_MS = 30_000;
/** A socket that says nothing for this long is dead, whatever it says. */
const SILENT_MS = 30_000;
/** The file is read as its first and last 64 KB: where the slicers keep the totals. */
const WINDOW = 64 * 1024;
/** A file that can't be read is tried again on later reads, this many times. */
const FILE_TRIES = 3;

export const octoprintConfigSchema = z.object({
  /** "192.168.1.70", "octopi.local" or "http://...". */
  host: z.string().trim().min(1).max(255),
  /** The printer's name in the app. */
  name: z.string().trim().max(100).optional(),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
});
type Config = z.infer<typeof octoprintConfigSchema>;

/** OctoPrint's API key (Settings → API, or an application key). */
export const octoprintSecretsSchema = z.object({ apiKey: z.string().optional() });

/** The base URL: http:// unless the host says otherwise, no trailing slash. */
export const baseUrl = (host: string) =>
  (/^https?:\/\//i.test(host) ? host : `http://${host}`).replace(/\/+$/, "");

const loginSchema = z.object({ name: z.string(), session: z.string() });
const versionSchema = z.object({ server: z.string().optional(), text: z.string().optional() });

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** The first and the last `WINDOW` bytes of a body, read as a stream and cut off after the head if asked. */
async function ends(res: Response, headOnly: boolean) {
  let head: Uint8Array = new Uint8Array();
  let tail: Uint8Array = new Uint8Array();
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) return { head, tail, total };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (head.length < WINDOW) head = concat(head, value.subarray(0, WINDOW - head.length));
      if (headOnly && head.length >= WINDOW) break;
      tail = concat(tail, value);
      if (tail.length > WINDOW) tail = tail.subarray(tail.length - WINDOW);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { head, tail, total };
}

export function octoprintAdapter(): IntegrationAdapter {
  return {
    id: "octoprint",
    kind: "host",
    capabilities: ["printers", "printerStatus"],
    configSchema: octoprintConfigSchema,
    secretsSchema: octoprintSecretsSchema,
    create: (ctx: IntegrationContext) => {
      const { config, secrets, log, signal } = ctx as IntegrationContext & { config: Config };
      const base = baseUrl(config.host);

      const send = async (path: string, init: RequestInit = {}, ms = REQUEST_MS) => {
        const key = await secrets.get("apiKey");
        try {
          return await fetch(`${base}${path}`, {
            ...init,
            headers: {
              accept: "application/json",
              ...(key && { "x-api-key": key }),
              ...init.headers,
            },
            signal: AbortSignal.any([signal, AbortSignal.timeout(ms)]),
          });
        } catch (err) {
          const cause = (err as { cause?: { code?: string } }).cause;
          log.debug(
            { path, err: (err as Error).name, cause: cause?.code },
            "octoprint unreachable",
          );
          throw new IntegrationError("unreachable");
        }
      };
      /** A request that must be answered: a refused key and an odd answer are told apart. */
      const checked = async (path: string, init?: RequestInit, ms?: number) => {
        const res = await send(path, init, ms);
        if (res.status === 401 || res.status === 403) {
          log.debug({ path, status: res.status }, "octoprint key refused");
          await res.body?.cancel();
          throw new IntegrationError("auth_required");
        }
        return res;
      };
      const json = async <T>(res: Response, schema: z.ZodType<T>, path: string): Promise<T> => {
        const r = schema.safeParse(await res.json().catch(() => undefined));
        if (r.success) return r.data;
        log.warn(
          { path, issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) },
          "unexpected octoprint response",
        );
        throw new IntegrationError("api_changed");
      };

      // The push socket: kept open, read at each status read.
      const model = createModel();
      let socket: WebSocket | undefined;
      let opening: Promise<void> | undefined;
      let lastMessage = 0;
      let warned = false;

      async function open() {
        const res = await checked("/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ passive: true }),
        });
        if (!res.ok) {
          log.debug({ status: res.status }, "octoprint login rejected");
          await res.body?.cancel();
          throw new IntegrationError(res.status >= 500 ? "unreachable" : "api_changed");
        }
        const login = await json(res, loginSchema, "/api/login");
        const ws = new WebSocket(`${base.replace(/^http/i, "ws")}/sockjs/websocket`);
        socket = ws;
        lastMessage = Date.now();
        signal.addEventListener("abort", () => ws.close(), { once: true });
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, REQUEST_MS);
          const done = () => {
            clearTimeout(timer);
            resolve();
          };
          ws.addEventListener("open", () => {
            // One `current` every 2 s instead of every 500 ms.
            ws.send(JSON.stringify({ auth: `${login.name}:${login.session}` }));
            ws.send(JSON.stringify({ throttle: 4 }));
          });
          ws.addEventListener("message", (e) => {
            lastMessage = Date.now();
            let msg: unknown;
            try {
              msg = JSON.parse(String(e.data));
            } catch {
              return;
            }
            if (!model.push(msg, new Date().toISOString()) && !warned) {
              warned = true;
              log.warn({}, "unexpected octoprint push message");
            }
            const m = msg as { current?: unknown; history?: unknown };
            if (m.current || m.history) done();
          });
          ws.addEventListener("close", () => {
            if (socket === ws) {
              socket = undefined;
              model.disconnected();
            }
            done();
          });
          ws.addEventListener("error", () => log.debug({}, "octoprint push socket error"));
        });
      }

      async function connect() {
        if (socket && Date.now() - lastMessage > SILENT_MS) {
          log.debug({}, "octoprint push socket silent, reconnecting");
          socket.close();
          socket = undefined;
          model.disconnected();
        }
        if (socket) return opening;
        opening = open().finally(() => {
          opening = undefined;
        });
        return opening;
      }

      // The job file's totals: read once per file, not on every read.
      const totals = new Map<string, { value?: JobTotal[]; tries: number }>();
      async function totalsOf(f: FileRef): Promise<JobTotal[] | undefined> {
        if (f.origin !== "local") return undefined;
        const key = `${f.origin}/${f.path}:${f.size ?? ""}`;
        let entry = totals.get(key);
        if (!entry) {
          entry = { tries: 0 };
          totals.set(key, entry);
          if (totals.size > 8) totals.delete(totals.keys().next().value as string);
        }
        if (entry.value || entry.tries >= FILE_TRIES) return entry.value;
        entry.tries++;
        try {
          entry.value = await readTotals(f);
        } catch (e) {
          log.debug(
            { tries: entry.tries, code: e instanceof IntegrationError ? e.code : "unknown" },
            "octoprint job file not read",
          );
        }
        return entry.value;
      }

      /** A ranged download honours `Range`; one that doesn't is streamed and cut off. */
      async function readTotals(f: FileRef): Promise<JobTotal[]> {
        const path = `/downloads/files/${f.origin}/${f.path.split("/").map(encodeURIComponent).join("/")}`;
        const binary = /\.bgcode$/i.test(f.path);
        const get = (range: string) =>
          checked(path, { headers: { range } }, FILE_MS).then(async (res) => {
            if (!res.ok || !res.body) {
              await res.body?.cancel();
              throw new IntegrationError("api_changed");
            }
            return res;
          });
        const first = await get(`bytes=0-${WINDOW - 1}`);
        const partial = first.status === 206;
        // Of a ranged answer, the file's size is the number after the slash, not what came.
        const whole = Number(/\/(\d+)\s*$/.exec(first.headers.get("content-range") ?? "")?.[1]);
        const a = await ends(first, binary || partial);
        if (binary) return readJobTotals(a.head);
        if (!partial) return readJobTotals(a.total <= WINDOW ? a.head : concat(a.head, a.tail));
        const size = Number.isFinite(whole) ? whole : f.size;
        if (size != null && size <= WINDOW) return readJobTotals(a.head);
        const b = await ends(await get(`bytes=-${WINDOW}`), false);
        return readJobTotals(concat(a.head, b.tail));
      }

      return {
        test: async () => {
          try {
            const v = await checked("/api/version");
            if (!v.ok) return { ok: false, code: "api_changed" };
            await json(v, versionSchema, "/api/version");
            // The version is public on some setups: the job needs the key.
            const j = await checked("/api/job");
            await j.body?.cancel();
            if (!j.ok && j.status !== 409) return { ok: false, code: "api_changed" };
            return { ok: true };
          } catch (e) {
            return { ok: false, code: e instanceof IntegrationError ? e.code : "unknown" };
          }
        },
        profile: async () => ({ name: config.name || "OctoPrint" }),
        printers: {
          listPrinters: async () => [
            {
              externalId: PRINTER_ID,
              name: config.name || "OctoPrint",
              brand: config.brand || "",
              model: config.model || "",
            },
          ],
        },
        status: {
          readStatus: async () => {
            try {
              await connect();
            } catch (e) {
              // A printer that doesn't answer is offline; a wrong key is the source's failure.
              if (!(e instanceof IntegrationError) || e.code !== "unreachable") throw e;
              model.disconnected();
            }
            const out: PrinterSnapshot[] = [];
            for (const { snap, file } of model.drain(new Date().toISOString()))
              out.push(withTotals(snap, file && snap.job ? await totalsOf(file) : undefined));
            return out;
          },
        },
      };
    },
  };
}
