import {
  type DevicePrinterStatus,
  type IntegrationAdapter,
  isRefused,
  PRINTER_BUSY_STATES,
  PRINTER_POLL_MS,
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
import { printersOfSource, sourceConfig, sourcePrinters } from "./printerSources.ts";
import { bridgeable } from "./sourceBridge.ts";
import type { Syncer } from "./sync.ts";

// Live status of every printer whose source has `printerStatus` (ADR-0015). Snapshots are kept in
// memory only; the job tracker's state per printer is stored, so a restart during a print still
// records it. A print the tracker sees end is written at once (`Syncer.recordPrint`).
//
// A source reached through a connector (`integrations.deviceId`, LAN reach) isn't read here: its
// connector reads it, tracks its jobs and posts the status (`relay`) and each ended print
// (`recordTracked`). The hub never tracks it too, so a print is never recorded twice.

export const POLL_MS = PRINTER_POLL_MS;
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
const setupOf = (row: { config: unknown; secrets: unknown; deviceId: string | null }) =>
  JSON.stringify([row.config, row.secrets, row.deviceId]);

type Source = {
  status: PrinterStatusSource;
  abort: AbortController;
  /** The setup it was made with (`setupOf`): a changed address or key gets a new instance. */
  version: string;
  timer?: NodeJS.Timeout;
  /** Printers it reported: one missing from a later read is offline. */
  known: Set<string>;
  failing: false | "refused" | "other";
};

/** A source its connector reads (ADR-0015, LAN reach). */
type Bridged = {
  deviceId: string;
  version: string;
  known: Set<string>;
  /** The printers whose job the connector's tracker follows, as it last said. */
  active: Set<string>;
  /** The source failed whole on its connector. */
  failing: false | "refused" | "other";
};

/** Why a printer is silent during a print: it stopped answering, or its connector is away. */
export type Silent = { printerId: string; reason: "printer" | "connector"; device?: string };

export function createPrinterStatus(
  db: Db,
  syncer: Pick<Syncer, "recordPrint" | "statusSource">,
  adapters: IntegrationAdapter[],
  log: FastifyBaseLogger,
  /** Polls on its own; off in tests, which call `refresh` and `pollAll`. */
  auto = false,
  /** Called when an alert may have opened or cleared. */
  alertsChanged: () => void = () => {},
  /** Connectors (the hub's channel): is one online, and tell it its printers changed. */
  hub: { online: (deviceId: string) => boolean; tell: (deviceId: string) => void } = {
    online: () => false,
    tell: () => {},
  },
) {
  const sources = new Map<string, Source>();
  const bridged = new Map<string, Bridged>();
  /** Per device, what its printers were made from: a change is told to its connector. */
  const assignments = new Map<string, string>();
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
  /** Printers that went silent while a job was active, by key: when it was first missed, and why. */
  const silentSince = new Map<string, { at: number; reason: Silent["reason"] }>();
  const listeners = new Set<(all: PrinterStatus[]) => void>();
  /** Adds what others know of a printer to its status (its loaded spools: `autoLoad`). */
  let annotate: () => (printerId: string) => Partial<PrinterStatus> = () => () => ({});
  let refreshTimer: NodeJS.Timeout | undefined;
  let closed = false;
  let sent = "";
  let alerted = "";
  let notifying = false;
  let again = false;

  const saveTrackers = () => {
    const value = Object.fromEntries(trackers);
    db.insert(schema.settings)
      .values({ key: TRACKERS, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run();
  };

  const deviceName = (deviceId: string) =>
    db
      .select({ name: schema.devices.name })
      .from(schema.devices)
      .where(eq(schema.devices.id, deviceId))
      .get()?.name ?? "";

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
    const extra = annotate();
    const names = new Map<string, string>();
    /** A source that fails whole (a wrong key) says so on each of its printers. */
    const failed = (integrationId: string): "refused" | "other" | undefined => {
      const b = bridged.get(integrationId);
      const how = b
        ? hub.online(b.deviceId)
          ? b.failing
          : false
        : sources.get(integrationId)?.failing;
      return how || undefined;
    };
    const viaOf = (integrationId: string) => {
      const b = bridged.get(integrationId);
      if (!b) return undefined;
      if (!names.has(b.deviceId)) names.set(b.deviceId, deviceName(b.deviceId));
      return {
        deviceId: b.deviceId,
        deviceName: names.get(b.deviceId) ?? "",
        online: hub.online(b.deviceId),
      };
    };
    const out = [...latest].flatMap(([key, { integrationId, snapshot }]) => {
      const printerId = ours.get(key);
      if (!printerId || archived.has(printerId)) return [];
      const via = viaOf(integrationId);
      return [
        {
          printerId,
          integrationId,
          snapshot,
          ...(via && { via }),
          ...(failed(integrationId) && { failing: failed(integrationId) }),
        },
      ];
    });
    // A source that never read its printer says why: it failed (a wrong key from the start), or it
    // has only just started (checking, not "not monitored").
    const seen = new Set(out.map((s) => `${s.integrationId}:${s.printerId}`));
    const at = new Date().toISOString();
    for (const id of sources.keys()) {
      for (const [ext, printerId] of printersOfSource(db, id)) {
        if (seen.has(`${id}:${printerId}`) || archived.has(printerId)) continue;
        const via = viaOf(id);
        out.push({
          printerId,
          integrationId: id,
          snapshot: { printerExternalId: ext, at, state: "offline", slots: [] },
          ...(via && { via }),
          ...(failed(id) ? { failing: failed(id) } : { pending: true }),
        });
      }
    }
    return out.map((s) => ({ ...s, ...extra(s.printerId) }));
  }

  /**
   * Tells the listeners when something besides the read time changed. A listener that changes
   * something itself (`autoLoad` loading a spool) calls it again: they hear the newer list after.
   */
  function notify() {
    if (notifying) {
      again = true;
      return;
    }
    notifying = true;
    try {
      do {
        again = false;
        const now = all();
        const key = JSON.stringify(now.map((s) => ({ ...s, snapshot: { ...s.snapshot, at: "" } })));
        if (key === sent) continue;
        sent = key;
        for (const l of listeners) l(now);
      } while (again);
    } finally {
      notifying = false;
    }
  }

  /** The alert check after a read: only when who is silent for too long changed. */
  function checkAlerts() {
    const down = offline()
      .map((s) => `${s.printerId}:${s.reason}`)
      .sort()
      .join();
    if (down === alerted) return;
    alerted = down;
    alertsChanged();
  }

  /** Silent during a print, or not (any more). */
  function silence(key: string, silent: boolean, at: string, reason: Silent["reason"]) {
    if (!silent) return void silentSince.delete(key);
    const was = silentSince.get(key);
    // The same silence keeps its start, also when its reason changes (the connector is back, the
    // printer still doesn't answer).
    if (!was || was.reason !== reason)
      silentSince.set(key, { at: was?.at ?? Date.parse(at), reason });
  }

  /**
   * A print the tracker saw end, here or on a connector: written, then its alert. False when
   * writing failed (a connector keeps it and sends it again); a print already there is done.
   */
  function recordTracked(integrationId: string, p: TrackedPrint) {
    try {
      if (syncer.recordPrint(integrationId, p)) raisePrint(integrationId, p);
      return true;
    } catch (err) {
      log.error({ err, integrationId }, "tracked print not written");
      return false;
    }
  }

  function apply(integrationId: string, snapshot: PrinterSnapshot) {
    const key = `${integrationId}:${snapshot.printerExternalId}`;
    latest.set(key, { integrationId, snapshot });
    const before = trackers.get(key) ?? { phase: "unknown" };
    const out = track(before, snapshot);
    trackers.set(key, out.state);
    // Stored when a job starts or ends, not on every read: a restart loses only the progress since.
    if (out.state.phase !== before.phase) saveTrackers();
    silence(
      key,
      snapshot.state === "offline" && out.state.phase === "active",
      snapshot.at,
      "printer",
    );
    for (const p of out.prints) recordTracked(integrationId, p);
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

  /** Our printers that have been silent for longer than `OFFLINE_ALERT_MS` in a print, and why. */
  function offline(now = Date.now()): Silent[] {
    const ours = new Map(
      all().map((s) => [`${s.integrationId}:${s.snapshot.printerExternalId}`, s]),
    );
    return [...silentSince].flatMap(([key, { at, reason }]) => {
      const s = ours.get(key);
      if (!s || now - at < OFFLINE_ALERT_MS) return [];
      return [{ printerId: s.printerId, reason, ...(s.via && { device: s.via.deviceName }) }];
    });
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
      src.failing = isRefused(err) ? "refused" : "other";
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
    checkAlerts();
    if (!auto) return;
    const busy = [...src.known].some((ext) =>
      PRINTER_BUSY_STATES.has(latest.get(`${id}:${ext}`)?.snapshot.state ?? "idle"),
    );
    src.timer = setTimeout(() => void poll(id), busy ? POLL_MS.busy : POLL_MS.idle).unref();
  }

  /**
   * What a connector read of a source assigned to it (`POST /api/hub/device/sources/status`).
   * False when that source isn't its own (moved to another machine meanwhile).
   */
  function relay(deviceId: string, r: DevicePrinterStatus) {
    const b = bridged.get(r.integrationId);
    if (!b || b.deviceId !== deviceId) return false;
    // Online is its event stream (ADR-0014). A read posted while it is away, or one still on its
    // way when the stream closed, would undo the offline its going away set.
    if (!hub.online(deviceId)) return true;
    const id = r.integrationId;
    const at = new Date().toISOString();
    const read: PrinterSnapshot[] = [];
    for (const raw of r.snapshots) {
      const s = printerSnapshotSchema.safeParse(raw);
      if (s.success) read.push(s.data);
      else log.warn({ integrationId: id, issues: s.error.issues }, "invalid printer status");
    }
    // A source that failed whole says nothing of its printers: they are out of sight.
    const answered = new Set(read.map((s) => s.printerExternalId));
    for (const ext of b.known)
      if (!answered.has(ext))
        read.push({ printerExternalId: ext, at, state: "offline", slots: [] });
    b.active = new Set(r.active);
    b.failing = r.failing ? (r.refused ? "refused" : "other") : false;
    for (const s of read) {
      const key = `${id}:${s.printerExternalId}`;
      latest.set(key, { integrationId: id, snapshot: s });
      silence(key, s.state === "offline" && b.active.has(s.printerExternalId), s.at, "printer");
      b.known.add(s.printerExternalId);
    }
    notify();
    checkAlerts();
    return true;
  }

  /** A connector went away: its printers are out of sight, and a print they ran unreachable. */
  function deviceOffline(deviceId: string) {
    // The app closing ends every stream.
    if (closed) return;
    const at = new Date().toISOString();
    for (const [id, b] of bridged) {
      if (b.deviceId !== deviceId) continue;
      for (const ext of b.known) {
        const key = `${id}:${ext}`;
        latest.set(key, {
          integrationId: id,
          snapshot: { printerExternalId: ext, at, state: "offline", slots: [] },
        });
        silence(key, b.active.has(ext), at, "connector");
      }
    }
    notify();
    checkAlerts();
  }

  function stop(id: string) {
    const src = sources.get(id);
    if (src) {
      clearTimeout(src.timer);
      src.abort.abort();
      sources.delete(id);
    }
    bridged.delete(id);
    for (const key of latest.keys()) if (key.startsWith(`${id}:`)) latest.delete(key);
    for (const key of silentSince.keys()) if (key.startsWith(`${id}:`)) silentSince.delete(key);
  }

  /**
   * Moved between this server and a connector: whoever tracked its jobs until now keeps that, and
   * the new one starts afresh (a job running then is first seen half-way, `partial`).
   */
  function forgetTrackers(id: string) {
    let gone = false;
    for (const key of trackers.keys())
      if (key.startsWith(`${id}:`)) gone = trackers.delete(key) || gone;
    if (gone) saveTrackers();
  }

  /** A source its connector reads: its printers, offline until the connector says otherwise. */
  function startBridged(id: string, deviceId: string, version: string) {
    const ours = [...sourcePrinters(db).keys()]
      .filter((k) => k.startsWith(`${id}:`))
      .map((k) => k.slice(id.length + 1));
    const b: Bridged = {
      deviceId,
      version,
      known: new Set(ours),
      active: new Set(),
      failing: false,
    };
    bridged.set(id, b);
    if (hub.online(deviceId)) return;
    const at = new Date().toISOString();
    for (const ext of b.known)
      latest.set(`${id}:${ext}`, {
        integrationId: id,
        snapshot: { printerExternalId: ext, at, state: "offline", slots: [] },
      });
  }

  /** Starts the sources that can say what their printers do and stops the ones that no longer can. */
  function refresh() {
    const rows = capableRows(db, adapters, "printerStatus");
    const now = new Map(rows.map((r) => [r.row.id, r]));
    // A source that reads its printer's serial starts again when the printer's changes.
    const versionOf = (r: (typeof rows)[number]) =>
      setupOf({ ...r.row, config: sourceConfig(db, r.row, r.adapter) });
    const via = (id: string) => {
      const r = now.get(id);
      return r && bridgeable(r.adapter) ? r.row.deviceId : null;
    };
    for (const [id, src] of [...sources, ...bridged]) {
      const r = now.get(id);
      const row = r?.row;
      if (r && versionOf(r) === src.version) continue;
      const before = bridged.get(id)?.deviceId ?? null;
      stop(id);
      if (!row || before !== via(id)) forgetTrackers(id);
    }
    for (const [id, r] of now) {
      if (sources.has(id) || bridged.has(id)) continue;
      const deviceId = via(id);
      if (deviceId) {
        startBridged(id, deviceId, versionOf(r));
        continue;
      }
      const abort = new AbortController();
      try {
        const status = syncer.statusSource(id, abort.signal);
        if (!status) continue;
        sources.set(id, {
          status,
          abort,
          version: versionOf(r),
          known: new Set(),
          failing: false,
        });
        if (auto) void poll(id);
      } catch (err) {
        log.warn({ err, integrationId: id }, "printer status source not started");
      }
    }
    // A connector whose printers changed fetches them again.
    const byDevice = new Map<string, string[]>();
    for (const [id, b] of bridged)
      byDevice.set(b.deviceId, [...(byDevice.get(b.deviceId) ?? []), `${id}:${b.version}`]);
    for (const deviceId of new Set([...assignments.keys(), ...byDevice.keys()])) {
      const fingerprint = (byDevice.get(deviceId) ?? []).sort().join();
      if ((assignments.get(deviceId) ?? "") === fingerprint) continue;
      if (fingerprint) assignments.set(deviceId, fingerprint);
      else assignments.delete(deviceId);
      hub.tell(deviceId);
    }
    notify();
    // Silent for long enough now, with no read to notice: a connector that went away.
    checkAlerts();
  }

  return {
    all,
    offline,
    refresh,
    relay,
    recordTracked,
    deviceOffline,
    /** Reads every source once, now. */
    pollAll: () => Promise.all([...sources.keys()].map(poll)).then(() => undefined),
    /** Called with every printer's status whenever one changes; returns the unsubscribe. */
    subscribe(l: (all: PrinterStatus[]) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** What each printer's status carries besides its source's read (`autoLoad.annotate`). */
    annotate(fn: typeof annotate) {
      annotate = fn;
    },
    /** Something `annotate` adds changed: the listeners hear it. */
    changed: () => notify(),
    start() {
      refresh();
      refreshTimer = setInterval(refresh, REFRESH_MS).unref();
    },
    close() {
      closed = true;
      clearInterval(refreshTimer);
      for (const id of [...sources.keys(), ...bridged.keys()]) stop(id);
      if (trackers.size) saveTrackers();
      listeners.clear();
    },
  };
}

export type PrinterStatusRunner = ReturnType<typeof createPrinterStatus>;
