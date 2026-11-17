import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DeviceSource,
  devicePrintsResultSchema,
  deviceSourceSchema,
  type HubEvent,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationInstance,
  isRefused,
  type Logger,
  PRINTER_BUSY_STATES,
  PRINTER_POLL_MS,
  type PrinterSnapshot,
  printerSnapshotSchema,
  type TrackedPrint,
  type TrackerState,
  track,
  tryOut,
} from "@3d-maker-suite/core";
import { type Blob, decrypt, encrypt, loadKey } from "@3d-maker-suite/host";
import { z } from "zod";
import type { Request } from "./roots.ts";

// The printers and spool library this connector reaches for its hub (ADR-0015, LAN reach). The hub
// assigns sources to it (`GET /api/hub/device/sources`, with their keys); the connector runs each
// adapter here, on their network, and the core job tracker on what a printer reports. It posts the
// latest status, and keeps every print the tracker saw end in `sources.json` until the hub has it:
// a print that ends while the hub is away is never lost. The assignment is kept there too,
// encrypted with `secret.key`, so it keeps watching through a restart while the hub is away.
// Nothing here sends a command to a printer. Its one write is to a spool library, and only what
// `spools.write` names (ADR-0014, 2026-11-17 Step 14b amendment): one spool's usage for one print
// slot, or one spool of the app's made there. It keeps no outbox for them: the hub does. And it
// tests a source the hub hasn't saved yet (`sources.test`, Step 16), once, read-only, and only a
// kind its machine's Reach switches allow (`X-Reach`): it refuses any other itself.

/** One ended print on its way to the hub. */
type Held = { key: string; integrationId: string; print: TrackedPrint };
type Saved = {
  /** `{ printers: <JSON of DeviceSource[]> }`, encrypted. */
  assigned?: Blob;
  trackers?: Record<string, TrackerState>;
  outbox?: Held[];
};
type Running = {
  /** What it was made from: a changed address or key gets a new instance. */
  setup: string;
  instance: IntegrationInstance;
  abort: AbortController;
  timer?: NodeJS.Timeout;
  /** Printers it reported: one missing from a later read is offline. */
  known: Set<string>;
  failing: false | "refused" | "other";
  /** Writes to it, one after another: a late one and its retry never read the same weight. */
  writing: Promise<unknown>;
};

/** Sent at most this many per request. */
const BATCH = 100;
/** A hub that never takes them: the oldest go first, so the file can't grow for ever. */
const OUTBOX_MAX = 1000;
const FILE = "sources.json";
const setupOf = (p: DeviceSource) => JSON.stringify([p.adapterId, p.config, p.secrets]);

/** The adapter's log, as lines: only its message and an error's text, never its objects (keys). */
function adapterLog(log: (line: string) => void, id: string): Logger {
  const line =
    (level: string) =>
    (obj: object | string, msg?: string): void => {
      const err = typeof obj === "object" && (obj as { err?: unknown }).err;
      const text = typeof obj === "string" ? obj : (msg ?? "");
      log(`printer ${id} ${level}: ${text}${err instanceof Error ? ` (${err.message})` : ""}`);
    };
  return { debug: () => {}, info: line("info"), warn: line("warn"), error: line("error") };
}

export function createSourceBridge({
  dataDir,
  request,
  adapters,
  log,
  pollMs = PRINTER_POLL_MS,
}: {
  dataDir: string;
  request: Request;
  /** The printer adapters this connector runs (sources/registry.ts). */
  adapters: IntegrationAdapter[];
  log: (line: string) => void;
  /** The read pace (tests); the server's by default. */
  pollMs?: { busy: number; idle: number };
}) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, FILE);
  const key = loadKey(dataDir);
  let saved: Saved = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {} // none yet, or damaged: the hub sends the assignment again
  let assigned: DeviceSource[] = [];
  try {
    if (saved.assigned)
      assigned = z
        .array(deviceSourceSchema)
        .parse(JSON.parse(decrypt(key, saved.assigned).printers ?? "[]"));
  } catch {} // another `secret.key`: the same
  const trackers = new Map(Object.entries(saved.trackers ?? {}));
  let outbox: Held[] = saved.outbox ?? [];
  const running = new Map<string, Running>();
  let stopped = false;
  let loading: Promise<void> | undefined;
  /** The kinds of source its Reach switches allow (`X-Reach`); unknown until the hub says. */
  let reach: Set<string> | undefined;
  let flushing: Promise<void> | undefined;

  const save = () => {
    const next: Saved = {
      assigned: encrypt(key, { printers: JSON.stringify(assigned) }),
      trackers: Object.fromEntries(trackers),
      outbox,
    };
    writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };

  function stopOne(id: string) {
    const run = running.get(id);
    if (!run) return;
    clearTimeout(run.timer);
    run.abort.abort();
    running.delete(id);
  }

  /** Starts the sources it was given, stops the rest; a source no longer its own loses its jobs. */
  function apply() {
    const now = new Map(assigned.map((p) => [p.integrationId, p]));
    for (const [id, run] of running) {
      const p = now.get(id);
      if (!p || setupOf(p) !== run.setup) stopOne(id);
    }
    let dropped = false;
    for (const k of trackers.keys())
      if (!now.has(k.slice(0, k.indexOf(":")))) dropped = trackers.delete(k) || dropped;
    if (dropped) save();
    if (stopped) return;
    for (const [id, p] of now) {
      if (running.has(id)) continue;
      const adapter = adapters.find((a) => a.id === p.adapterId);
      const config = adapter?.configSchema.safeParse(p.config);
      if (!adapter?.create || !config?.success) {
        log(`printer ${id}: ${adapter ? "invalid setup" : `no adapter ${p.adapterId}`}`);
        continue;
      }
      const abort = new AbortController();
      const secrets = { ...p.secrets };
      const instance = adapter.create({
        config: config.data,
        secrets: {
          get: async (k) => secrets[k],
          // A key the source refreshed is kept until the hub sends the assignment again.
          set: async (k, v) => {
            secrets[k] = v;
          },
          delete: async (k) => {
            delete secrets[k];
          },
        },
        log: adapterLog(log, id),
        signal: abort.signal,
      });
      running.set(id, {
        setup: setupOf(p),
        instance,
        abort,
        known: new Set(),
        failing: false,
        writing: Promise.resolve(),
      });
      void poll(id);
    }
  }

  async function poll(id: string) {
    const run = running.get(id);
    if (!run?.instance.status) return;
    clearTimeout(run.timer);
    const at = new Date().toISOString();
    let read: PrinterSnapshot[] = [];
    try {
      for (const raw of await run.instance.status.readStatus()) {
        const s = printerSnapshotSchema.safeParse(raw);
        if (s.success) read.push(s.data);
      }
      if (run.failing) log(`printer ${id}: read again`);
      run.failing = false;
    } catch (e) {
      // Once per outage; the adapter keeps its own error text free of keys.
      if (!run.failing)
        log(`printer ${id}: not read (${e instanceof IntegrationError ? e.code : "unknown"})`);
      run.failing = isRefused(e) ? "refused" : "other";
      read = [];
    }
    if (running.get(id) !== run) return;
    const answered = new Set(read.map((s) => s.printerExternalId));
    for (const ext of run.known)
      if (!answered.has(ext))
        read.push({ printerExternalId: ext, at, state: "offline", slots: [] });
    let changed = false;
    for (const s of read) {
      run.known.add(s.printerExternalId);
      const k = `${id}:${s.printerExternalId}`;
      const before = trackers.get(k) ?? { phase: "unknown" };
      const out = track(before, s);
      trackers.set(k, out.state);
      if (out.state.phase !== before.phase) changed = true;
      for (const print of out.prints) {
        const key = `${k}:${print.print.externalId}`;
        if (!outbox.some((h) => h.key === key)) outbox.push({ key, integrationId: id, print });
        changed = true;
      }
    }
    if (outbox.length > OUTBOX_MAX) outbox = outbox.slice(-OUTBOX_MAX);
    // On disk before anything is sent: a crash now still delivers it.
    if (changed) save();
    const active = [...run.known].filter((ext) => trackers.get(`${id}:${ext}`)?.phase === "active");
    void request("/sources/status", {
      method: "POST",
      body: {
        integrationId: id,
        snapshots: read,
        active,
        failing: !!run.failing,
        refused: run.failing === "refused",
      },
    }).catch(() => {}); // the hub is away: the next read sends the latest
    if (outbox.length) void flush();
    if (stopped || running.get(id) !== run) return;
    const busy = read.some((s) => PRINTER_BUSY_STATES.has(s.state));
    run.timer = setTimeout(() => void poll(id), busy ? pollMs.busy : pollMs.idle);
    run.timer.unref();
  }

  async function send() {
    try {
      while (outbox.length) {
        const batch = outbox.slice(0, BATCH);
        const res = await request("/sources/prints", { method: "POST", body: { items: batch } });
        if (!res.ok) return;
        const { done } = devicePrintsResultSchema.parse(await res.json());
        const gone = new Set(done);
        const before = outbox.length;
        outbox = outbox.filter((h) => !gone.has(h.key));
        save();
        // Nothing taken (it couldn't write them): try again with the next read.
        if (outbox.length === before) return;
      }
    } catch {
      // Away: they wait for the next read or connect.
    }
  }

  /** Sends the held prints; what the hub answers as done leaves the file. One at a time. */
  function flush() {
    // `finally` runs after the assignment, also when there is nothing to send.
    flushing ??= send().finally(() => {
      flushing = undefined;
    });
    return flushing;
  }

  async function fetchAssigned() {
    try {
      const res = await request("/sources");
      if (!res.ok) return;
      reach = new Set((res.headers.get("x-reach") ?? "").split(",").filter(Boolean));
      const list = z.array(deviceSourceSchema).safeParse(await res.json());
      if (!list.success) return;
      assigned = list.data;
      save();
      apply();
    } catch {
      // Away: it keeps what it has.
    }
  }

  /** Fetches what the hub assigns to this device (on every connect and when told). */
  function load() {
    loading ??= fetchAssigned().finally(() => {
      loading = undefined;
    });
    void loading.then(() => flush());
    return loading;
  }

  type Read = Extract<HubEvent, { type: "sources.read" }>;
  type Write = Extract<HubEvent, { type: "spools.write" }>;
  type Test = Extract<HubEvent, { type: "sources.test" }>;
  type Reply = (body: unknown) => Promise<unknown>;

  /** The running source a request names; one the hub assigned since is fetched first. */
  async function runningFor(integrationId: string) {
    await loading;
    if (!running.has(integrationId)) await load();
    return running.get(integrationId);
  }

  /** The hub asks for a source's test, printers, history or spools; never a command to a printer. */
  async function read(event: Read, reply: Reply) {
    const run = await runningFor(event.integrationId);
    if (!run) return void (await reply({ ok: false, code: "ENOENT" }));
    const { instance } = run;
    try {
      const result =
        event.op === "test"
          ? await instance.test()
          : event.op === "printers"
            ? ((await instance.printers?.listPrinters()) ?? [])
            : event.op === "spools"
              ? await instance.spools?.listSpools()
              : instance.printHistory
                ? await instance.printHistory.listPrints({
                    since: event.since,
                    until: event.until,
                    cursor: event.cursor,
                  })
                : undefined;
      if (result === undefined) return void (await reply({ ok: false, code: "ENOTSUP" }));
      await reply({ ok: true, result });
    } catch (e) {
      await reply({ ok: false, code: e instanceof IntegrationError ? e.code : "unknown" });
    }
  }

  /**
   * The hub writes what prints took to a spool library assigned to it: exactly the two writes of
   * `SpoolUsageTarget`, each idempotent in the adapter. Anything else answers ENOTSUP.
   */
  async function write(event: Write, reply: Reply) {
    const run = await runningFor(event.integrationId);
    if (!run) return void (await reply({ ok: false, code: "ENOENT" }));
    const target = run.instance.spoolUsage;
    if (!target) return void (await reply({ ok: false, code: "ENOTSUP" }));
    const w = event.write;
    const done = run.writing.then(
      (): Promise<unknown> =>
        w.op === "usage"
          ? target.writeUsage({ spoolId: w.spoolId, key: w.key, grams: w.grams, sent: w.sent })
          : target.createSpool(w.spool),
    );
    run.writing = done.catch(() => {});
    try {
      const result = await done;
      log(
        `spools ${event.integrationId}: ${w.op === "usage" ? `usage ${w.key} on spool ${w.spoolId}` : "spool made"}`,
      );
      await reply({ ok: true, result });
    } catch (e) {
      await reply({ ok: false, code: e instanceof IntegrationError ? e.code : "unknown" });
    }
  }

  /**
   * The hub tests a source it hasn't saved yet (ADR-0014 `sources.test`): one `test()` and the
   * printers it finds, with the adapter's own protocol, then the instance goes. Nothing is kept or
   * logged but the adapter's lines. A kind of source its Reach switch is off for answers EACCES,
   * whatever the hub asks; an adapter it doesn't run ENOTSUP.
   */
  async function test(event: Test, reply: Reply) {
    await loading;
    if (!reach) await load();
    const adapter = adapters.find((a) => a.id === event.adapterId);
    const caps = adapter?.capabilities ?? [];
    if (
      !adapter?.create ||
      adapter.kind !== "host" ||
      !caps.some((c) => c === "printerStatus" || c === "spools" || c === "spoolUsage")
    )
      return void (await reply({ ok: false, code: "ENOTSUP" }));
    const kind = caps.includes("printerStatus") ? "printers" : "spool-libraries";
    if (!reach?.has(kind)) return void (await reply({ ok: false, code: "EACCES" }));
    const config = adapter.configSchema.safeParse(event.config);
    if (!config.success) return void (await reply({ ok: false, code: "EINVAL" }));
    const result = await tryOut(adapter, {
      config: config.data,
      secrets: event.secrets,
      log: adapterLog(log, "test"),
    });
    log(`test of a ${event.adapterId} source: ${result.ok ? "ok" : result.code}`);
    await reply({ ok: true, result });
  }

  // What it was given last time: watching starts before the hub answers, or without it.
  apply();

  return {
    /** The adapters it runs, for the hub (`X-Source-Adapters`). */
    adapterIds: () => adapters.map((a) => a.id),
    load,
    read,
    write,
    test,
    flush,
    /** The prints waiting for the hub (tests, status). */
    held: () => outbox.length,
    /** The sources it reads now. */
    watching: () => running.size,
    /** Stops watching (the process ends); the file stays for the next start. */
    stop() {
      stopped = true;
      for (const id of [...running.keys()]) stopOne(id);
    },
    /** Unpaired or revoked: nothing of the hub's stays, its keys least of all. A new pair loads anew. */
    forget() {
      for (const id of [...running.keys()]) stopOne(id);
      assigned = [];
      reach = undefined;
      trackers.clear();
      outbox = [];
      rmSync(file, { force: true });
    },
  };
}

export type SourceBridge = ReturnType<typeof createSourceBridge>;
