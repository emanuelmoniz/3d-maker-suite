import {
  type IntegrationAdapter,
  type PrinterSnapshot,
  type PrinterStatus,
  type PrinterStatusSource,
  printerSnapshotSchema,
  type TrackedPrint,
  type TrackerState,
  track,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { raise } from "../alerts/evaluate.ts";
import { printerTitle } from "../lib/numbers.ts";
import { capableRows } from "./capabilities.ts";
import { sourcePrinters } from "./printerSources.ts";
import type { Syncer } from "./sync.ts";

// Live status of every printer whose source has `printerStatus` (ADR-0015). Snapshots are kept in
// memory only; the job tracker's state per printer is stored, so a restart during a print still
// records it. A print the tracker sees end is written at once (`Syncer.recordPrint`).

// ponytail: one pace for every adapter (ADR-0015: "a few seconds while printing, slower when
// idle"). Give `PrinterStatusSource` its own if a printer can't take it.
export const POLL_MS = { busy: 3_000, idle: 15_000 };
/**
 * How long a printer may stay silent during a print before it is "offline" for alerts.
 * ponytail: fixed, make it a preference if anyone asks.
 */
export const OFFLINE_ALERT_MS = 2 * 60_000;
/** How often the sources are looked up again: one switched on, off or set up anew. */
const REFRESH_MS = 10_000;
/** Kept between restarts; `settings` holds JSON. */
const TRACKERS = "printerTrackers";
/** What a source is made from; not `updatedAt`, which every sync moves. */
const setupOf = (row: { config: unknown; secrets: unknown }) =>
  JSON.stringify([row.config, row.secrets]);
const BUSY = new Set<PrinterSnapshot["state"]>(["preparing", "printing", "paused"]);

type Source = {
  status: PrinterStatusSource;
  abort: AbortController;
  /** The setup it was made with (`setupOf`): a changed address or key gets a new instance. */
  version: string;
  timer?: NodeJS.Timeout;
  /** Printers it reported: one missing from a later read is offline. */
  known: Set<string>;
  failing: boolean;
};

export function createPrinterStatus(
  db: Db,
  syncer: Pick<Syncer, "recordPrint" | "statusSource">,
  adapters: IntegrationAdapter[],
  log: FastifyBaseLogger,
  /** Polls on its own; off in tests, which call `refresh` and `pollAll`. */
  auto = false,
  /** Called when an alert may have opened or cleared. */
  alertsChanged: () => void = () => {},
) {
  const sources = new Map<string, Source>();
  /** By `<integrationId>:<printerExternalId>`. */
  const latest = new Map<string, { integrationId: string; snapshot: PrinterSnapshot }>();
  const stored = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, TRACKERS))
    .get()?.value;
  const trackers = new Map<string, TrackerState>(
    Object.entries((stored ?? {}) as Record<string, TrackerState>),
  );
  /** Printers that went silent while a job was active, by key: when it was first missed. */
  const silentSince = new Map<string, number>();
  const listeners = new Set<(all: PrinterStatus[]) => void>();
  let refreshTimer: NodeJS.Timeout | undefined;
  let sent = "";
  let alerted = "";

  const saveTrackers = () => {
    const value = Object.fromEntries(trackers);
    db.insert(schema.settings)
      .values({ key: TRACKERS, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run();
  };

  /**
   * Every printer with a status that is one of ours (imported from its source or linked to it by
   * serial, not archived).
   */
  function all(): PrinterStatus[] {
    const archived = new Set(
      db
        .select({ id: schema.printers.id })
        .from(schema.printers)
        .where(isNotNull(schema.printers.archivedAt))
        .all()
        .map((p) => p.id),
    );
    const ours = sourcePrinters(db);
    return [...latest].flatMap(([key, { integrationId, snapshot }]) => {
      const printerId = ours.get(key);
      return printerId && !archived.has(printerId) ? [{ printerId, integrationId, snapshot }] : [];
    });
  }

  /** Tells the listeners when something besides the read time changed. */
  function notify() {
    const now = all();
    const key = JSON.stringify(now.map((s) => ({ ...s, snapshot: { ...s.snapshot, at: "" } })));
    if (key === sent) return;
    sent = key;
    for (const l of listeners) l(now);
  }

  function apply(integrationId: string, snapshot: PrinterSnapshot) {
    const key = `${integrationId}:${snapshot.printerExternalId}`;
    latest.set(key, { integrationId, snapshot });
    const before = trackers.get(key) ?? { phase: "unknown" };
    const out = track(before, snapshot);
    trackers.set(key, out.state);
    // Stored when a job starts or ends, not on every read: a restart loses only the progress since.
    if (out.state.phase !== before.phase) saveTrackers();
    if (snapshot.state === "offline" && out.state.phase === "active")
      silentSince.set(key, silentSince.get(key) ?? Date.parse(snapshot.at));
    else silentSince.delete(key);
    for (const p of out.prints)
      try {
        if (syncer.recordPrint(integrationId, p)) raisePrint(integrationId, p);
      } catch (err) {
        log.error({ err, integrationId }, "tracked print not written");
      }
  }

  /** One alert per print the tracker wrote; a cancelled one raises none, and history never gets here. */
  function raisePrint(integrationId: string, { print }: TrackedPrint) {
    if (print.outcome === "cancelled") return;
    const row = db
      .select({ id: schema.prints.id, title: schema.prints.title, printer: schema.printers })
      .from(schema.prints)
      .innerJoin(schema.printers, eq(schema.printers.id, schema.prints.printerId))
      .where(
        and(
          eq(schema.prints.integrationId, integrationId),
          eq(schema.prints.externalId, print.externalId),
        ),
      )
      .get();
    if (!row) return;
    raise(db, {
      kind: print.outcome === "success" ? "print_finished" : "print_failed",
      severity: print.outcome === "success" ? "success" : "error",
      module: "printers",
      task: `print:${row.id}`,
      entityType: "print",
      entityId: row.id,
      context: { title: row.title, printer: printerTitle(row.printer) },
    });
  }

  /** Our printers (ids) that have been silent for longer than `OFFLINE_ALERT_MS` in a print. */
  function offline(now = Date.now()): string[] {
    const ours = new Map(
      all().map((s) => [`${s.integrationId}:${s.snapshot.printerExternalId}`, s]),
    );
    return [...silentSince]
      .filter(([, since]) => now - since >= OFFLINE_ALERT_MS)
      .flatMap(([key]) => ours.get(key)?.printerId ?? []);
  }

  async function poll(id: string) {
    const src = sources.get(id);
    if (!src) return;
    clearTimeout(src.timer);
    const at = new Date().toISOString();
    let read: PrinterSnapshot[] = [];
    try {
      for (const raw of await src.status.readStatus()) {
        const s = printerSnapshotSchema.safeParse(raw);
        if (s.success) read.push(s.data);
        else log.warn({ integrationId: id, issues: s.error.issues }, "invalid printer status");
      }
      if (src.failing) log.info({ integrationId: id }, "printer status is read again");
      src.failing = false;
    } catch (err) {
      // Logged once per outage; the source's own error is the adapter's to keep out of the log.
      if (!src.failing) log.warn({ integrationId: id, err }, "printer status not read");
      src.failing = true;
      read = [];
    }
    // The source stopped while it was reading.
    if (sources.get(id) !== src) return;
    for (const s of read) apply(id, s);
    const answered = new Set(read.map((s) => s.printerExternalId));
    for (const ext of src.known)
      if (!answered.has(ext))
        apply(id, { printerExternalId: ext, at, state: "offline", slots: [] });
    for (const ext of answered) src.known.add(ext);
    notify();
    const down = offline().sort().join();
    if (down !== alerted) {
      alerted = down;
      alertsChanged();
    }
    if (!auto) return;
    const busy = [...src.known].some((ext) =>
      BUSY.has(latest.get(`${id}:${ext}`)?.snapshot.state ?? "idle"),
    );
    src.timer = setTimeout(() => void poll(id), busy ? POLL_MS.busy : POLL_MS.idle).unref();
  }

  function stop(id: string) {
    const src = sources.get(id);
    if (!src) return;
    clearTimeout(src.timer);
    src.abort.abort();
    sources.delete(id);
    for (const key of latest.keys()) if (key.startsWith(`${id}:`)) latest.delete(key);
    for (const key of silentSince.keys()) if (key.startsWith(`${id}:`)) silentSince.delete(key);
  }

  /** Starts the sources that can say what their printers do and stops the ones that no longer can. */
  function refresh() {
    const rows = capableRows(db, adapters, "printerStatus");
    const now = new Map(rows.map((r) => [r.row.id, r.row]));
    for (const [id, src] of sources) {
      const row = now.get(id);
      if (!row || setupOf(row) !== src.version) stop(id);
    }
    for (const [id, row] of now) {
      if (sources.has(id)) continue;
      const abort = new AbortController();
      try {
        const status = syncer.statusSource(id, abort.signal);
        if (!status) continue;
        sources.set(id, {
          status,
          abort,
          version: setupOf(row),
          known: new Set(),
          failing: false,
        });
        if (auto) void poll(id);
      } catch (err) {
        log.warn({ err, integrationId: id }, "printer status source not started");
      }
    }
    notify();
  }

  return {
    all,
    offline,
    refresh,
    /** Reads every source once, now. */
    pollAll: () => Promise.all([...sources.keys()].map(poll)).then(() => undefined),
    /** Called with every printer's status whenever one changes; returns the unsubscribe. */
    subscribe(l: (all: PrinterStatus[]) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start() {
      refresh();
      refreshTimer = setInterval(refresh, REFRESH_MS).unref();
    },
    close() {
      clearInterval(refreshTimer);
      for (const id of [...sources.keys()]) stop(id);
      if (trackers.size) saveTrackers();
      listeners.clear();
    },
  };
}

export type PrinterStatusRunner = ReturnType<typeof createPrinterStatus>;
