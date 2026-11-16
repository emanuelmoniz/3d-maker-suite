import { readJobTotals } from "@3d-maker-suite/3mf";
import {
  type IntegrationAdapter,
  type IntegrationContext,
  IntegrationError,
  type PrinterSnapshot,
} from "@3d-maker-suite/core";
import mqtt from "mqtt";
import { z } from "zod";
import { download } from "./ftps.ts";
import {
  endOf,
  isEnd,
  isRunning,
  type Job,
  mergeReport,
  type Report,
  startOf,
  toSnapshot,
  totalsOnSlots,
} from "./map.ts";
import { type Announce, watchPrinters } from "./ssdp.ts";

// Bambu LAN (ADR-0015): one printer's local MQTT feed over TLS, signed in with its access code.
// Works while the printer stays on the cloud, with LAN Only and Developer mode off (A1, Step 1),
// next to a Bambu Cloud source of the same printer (matched by serial) or alone. Read-only: the
// only requests sent are `get_version` and `pushall`, and the job file is read over FTPS.
// A raw message is never logged: the feed also carries the access code when another client asks
// for it (`system: get_access_code`), and only the `print` and version parts are kept.

const MQTT_PORT = 8883;
/** How long a sign-in may take before the printer counts as unreachable. */
const READY_MS = 10_000;
/** The first status read waits this long for the printer's full report. */
const FIRST_READ_MS = 8_000;
/** A job file that can't be read is tried again on later reports, this many times. */
const FILE_TRIES = 3;

export const bambuLanConfigSchema = z
  .object({
    /** The printer's IP. Unset: found by its broadcast, which a server in bridged Docker doesn't get. */
    host: z.string().trim().max(255).optional(),
    /** On the printer's screen and in Bambu Studio's device page. Unset: read from the printer. */
    serial: z.string().trim().max(64).optional(),
    /** The printer's name in the app; unset = the name it announces. */
    name: z.string().trim().max(100).optional(),
  })
  .refine((c) => !!c.host || !!c.serial, { message: "host or serial" });
type Config = z.infer<typeof bambuLanConfigSchema>;

/** On the printer's screen (A1: Settings → LAN Only Mode; X1, P1: Settings → Network). */
export const bambuLanSecretsSchema = z.object({ accessCode: z.string().min(1) });

/** The part of mqtt.js's client the adapter uses, so tests can feed it the fixtures. */
export interface MqttLink {
  on(event: "connect", cb: () => void): unknown;
  on(event: "message", cb: (topic: string, payload: Buffer) => void): unknown;
  on(event: "error", cb: (err: Error & { code?: number | string }) => void): unknown;
  on(event: "close" | "offline", cb: () => void): unknown;
  subscribe(topic: string): unknown;
  publish(topic: string, payload: string): unknown;
  end(force?: boolean): unknown;
  /** The printer's certificate is issued to its serial. */
  stream?: unknown;
}

export interface LanDeps {
  connect(url: string, opts: { username: string; password: string }): MqttLink;
  download: typeof download;
  watch: typeof watchPrinters;
}

const realDeps: LanDeps = {
  connect: (url, opts) =>
    mqtt.connect(url, {
      ...opts,
      // Signed by Bambu's own CA ("BBL CA"), not one Node knows.
      // ponytail: pin Bambu's CA if a printer on a shared network ever needs it.
      rejectUnauthorized: false,
      reconnectPeriod: 5_000,
      connectTimeout: READY_MS,
    }) as unknown as MqttLink,
  download,
  watch: watchPrinters,
};

const MODELS: Record<string, string> = {
  N1: "A1 mini",
  N2S: "A1",
  C11: "P1P",
  C12: "P1S",
  C13: "X1E",
  "3DPrinter-X1-Carbon": "X1 Carbon",
  "3DPrinter-X1": "X1",
  O1D: "H2D",
};

const versionSchema = z.object({
  command: z.literal("get_version"),
  module: z.array(z.object({ name: z.string(), product_name: z.string().nullish() })).default([]),
});

/** One connection to the printer, with what it reported so far. */
function link(ctx: IntegrationContext, deps: LanDeps, code: string) {
  const config = ctx.config as Config;
  const { log } = ctx;
  let serial = config.serial || undefined;
  let announced: Announce | undefined;
  let host = config.host || undefined;
  let client: MqttLink | undefined;
  let connected = false;
  let authFailed = false;
  let report: Report = {};
  let model: string | undefined;
  let job: Job = {};
  /** An end the next read must return, even if the printer moved on before it. */
  let pendingEnd: PrinterSnapshot | undefined;
  let reading = false;
  let tries = 0;
  /** Counts jobs: a file read late still belongs to the job it was read for, ended or not. */
  let jobNo = 0;
  const waiting = new Set<() => void>();
  const changed = () => {
    for (const w of waiting) w();
  };
  const abort = new AbortController();

  function onPrint(print: Report) {
    const start = startOf(print);
    if (start) {
      // A new print sent to the printer: its slots, plate and start come with it.
      job = { start };
      tries = 0;
      jobNo++;
      return;
    }
    const before = report;
    report = mergeReport(report, print);
    const wasRunning = isRunning(before);
    if (isRunning(report) && !wasRunning && job.end) {
      // Started without a start command we saw (on the printer, or before we were watching).
      job = {};
      tries = 0;
      jobNo++;
    }
    if (isEnd(report) && before.gcode_state !== report.gcode_state && !job.end) {
      job = { ...job, end: endOf(report) };
      pendingEnd = serial
        ? toSnapshot(serial, report, new Date().toISOString(), job, model)
        : undefined;
    }
    readFile();
  }

  /** The job's 3MF from the printer, once per print: the grams per filament (ADR-0015, "Grams"). */
  function readFile() {
    const file = typeof report.gcode_file === "string" ? report.gcode_file : "";
    if (!file || !host || reading || job.totals || tries >= FILE_TRIES || !isRunning(report))
      return;
    reading = true;
    tries++;
    const forJob = jobNo;
    const mapping = job.start?.mapping;
    const at = host;
    // ponytail: /cache is where a print sent to the printer lands (A1, Step 1); the others are
    // guesses for a print started from the SD card.
    const paths = new Set(
      file.startsWith("/")
        ? [file, file.replace(/^\/(mnt\/)?sdcard/, "")]
        : [`/cache/${file}`, `/${file}`],
    );
    void (async () => {
      try {
        for (const path of paths) {
          const bytes = await deps.download(at, code, path, abort.signal);
          if (!bytes) continue;
          const totals = totalsOnSlots(
            await readJobTotals(bytes),
            mapping,
            Number((report.ams as { tray_now?: unknown } | undefined)?.tray_now),
          );
          if (jobNo === forJob) job = { ...job, totals };
          return;
        }
        log.debug({ tries }, "bambu job file not on the printer");
      } catch (e) {
        log.debug(
          { code: e instanceof IntegrationError ? e.code : "unknown" },
          "bambu job file not read",
        );
      } finally {
        reading = false;
      }
    })();
  }

  function onMessage(payload: Buffer) {
    let msg: unknown;
    try {
      msg = JSON.parse(payload.toString("utf8"));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const { print, info } = msg as { print?: unknown; info?: unknown };
    if (print && typeof print === "object") onPrint(print as Report);
    const v = versionSchema.safeParse(info);
    if (v.success) {
      const name = v.data.module.find((m) => m.name === "ota")?.product_name;
      if (name) model = name.replace(/^Bambu Lab\s+/i, "");
    }
    changed();
  }

  function open(at: string) {
    client?.end(true);
    connected = false;
    const c = deps.connect(`mqtts://${at}:${MQTT_PORT}`, { username: "bblp", password: code });
    client = c;
    c.on("connect", () => {
      if (client !== c) return;
      connected = true;
      authFailed = false;
      const cert = (
        c.stream as { getPeerCertificate?(): { subject?: { CN?: string } } } | undefined
      )?.getPeerCertificate?.();
      serial ??= cert?.subject?.CN || undefined;
      if (!serial) {
        log.warn({}, "bambu printer didn't say its serial: set it in the integration");
        return;
      }
      c.subscribe(`device/${serial}/report`);
      const request = (body: object) => c.publish(`device/${serial}/request`, JSON.stringify(body));
      request({ info: { sequence_id: "0", command: "get_version" } });
      request({ pushing: { sequence_id: "0", command: "pushall" } });
    });
    c.on("message", (_topic, payload) => {
      if (client === c) onMessage(payload);
    });
    c.on("error", (e) => {
      // MQTT 3.1.1 refusals: 4 = bad user name or password, 5 = not authorized.
      if (e.code === 4 || e.code === 5) authFailed = true;
      log.debug({ code: e.code ?? (e as Error).name }, "bambu printer connection failed");
      changed();
    });
    for (const event of ["close", "offline"] as const)
      c.on(event, () => {
        if (client !== c) return;
        connected = false;
        changed();
      });
  }

  const unwatch = deps.watch(
    (a) => {
      if (serial ? a.serial !== serial : a.host !== config.host) return;
      serial ??= a.serial;
      announced = a;
      // It moved to another IP (DHCP): follow it by its serial.
      if (a.host !== host) {
        log.info({}, "bambu printer found at a new address");
        host = a.host;
        open(a.host);
      }
    },
    (port, err) => log.debug({ port, err }, "bambu printer broadcast not heard"),
  );
  // The broadcast may have placed it already.
  if (host && !client) open(host);

  return {
    get serial() {
      return serial;
    },
    get model() {
      return model ?? (announced?.modelCode && MODELS[announced.modelCode]) ?? undefined;
    },
    get name() {
      return config.name || announced?.name || undefined;
    },
    get report() {
      return report;
    },
    /** Waits until `ok` holds or `ms` pass; throws the sign-in's failure. */
    async until(ok: () => boolean, ms: number) {
      const end = Date.now() + ms;
      while (!ok() && !authFailed && Date.now() < end) {
        await new Promise<void>((r) => {
          const done = () => {
            clearTimeout(t);
            waiting.delete(done);
            r();
          };
          const t = setTimeout(done, end - Date.now());
          waiting.add(done);
        });
      }
      if (authFailed) throw new IntegrationError("auth_required");
      return ok();
    },
    ready: () => connected && typeof report.gcode_state === "string",
    snapshot(): PrinterSnapshot | undefined {
      if (authFailed) throw new IntegrationError("auth_required");
      if (!serial) return;
      const at = new Date().toISOString();
      if (pendingEnd) {
        const end = { ...pendingEnd, at };
        pendingEnd = undefined;
        return end;
      }
      if (!connected || typeof report.gcode_state !== "string")
        return { printerExternalId: serial, at, state: "offline", slots: [] };
      return toSnapshot(serial, report, at, job, model);
    },
    close() {
      abort.abort();
      unwatch();
      client?.end(true);
      client = undefined;
    },
  };
}

export function bambuLanAdapter(deps: Partial<LanDeps> = {}): IntegrationAdapter {
  const use = { ...realDeps, ...deps };
  return {
    id: "bambu-lan",
    kind: "host",
    capabilities: ["printers", "printerStatus"],
    configSchema: bambuLanConfigSchema,
    configAnyOf: ["host", "serial"],
    secretsSchema: bambuLanSecretsSchema,
    create: (ctx) => {
      const code = () => ctx.secrets.get("accessCode");
      /** The live feed, kept for status reads until the source stops. */
      let live: ReturnType<typeof link> | undefined;
      ctx.signal.addEventListener("abort", () => live?.close(), { once: true });

      /** A short connection for a test or a listing: the full report and the model, then closed. */
      async function once<T>(fn: (l: ReturnType<typeof link>) => T): Promise<T> {
        const key = await code();
        if (!key) throw new IntegrationError("auth_required");
        if (live?.ready()) return fn(live);
        const l = link(ctx, use, key);
        try {
          if (!(await l.until(() => l.ready() && !!l.model, READY_MS)) && !l.ready())
            throw new IntegrationError("unreachable");
          return fn(l);
        } finally {
          l.close();
        }
      }

      const printer = (l: ReturnType<typeof link>) => {
        const serial = l.serial ?? "";
        const nozzle = Number(l.report.nozzle_diameter);
        return {
          externalId: serial,
          serial,
          name: l.name || (l.model ? `Bambu Lab ${l.model}` : serial),
          brand: "Bambu Lab",
          model: l.model ?? "",
          ...(nozzle > 0 && { nozzleDiameterMm: nozzle }),
        };
      };

      return {
        test: async () => {
          try {
            await once(() => undefined);
            return { ok: true };
          } catch (e) {
            return { ok: false, code: e instanceof IntegrationError ? e.code : "unknown" };
          }
        },
        profile: () => once((l) => ({ name: printer(l).name })),
        printers: { listPrinters: () => once((l) => [printer(l)]) },
        status: {
          readStatus: async () => {
            if (!live) {
              const key = await code();
              if (!key) throw new IntegrationError("auth_required");
              live = link(ctx, use, key);
              if (ctx.signal.aborted) live.close();
              await live.until(live.ready, FIRST_READ_MS);
            }
            const snap = live.snapshot();
            return snap ? [snap] : [];
          },
        },
      };
    },
  };
}
