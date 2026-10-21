import type {
  AlertDetail,
  AlertKind,
  AlertModule,
  AlertSeverity,
  MaintenanceDueItem,
  Notification,
  SyncLogEntry,
  SyncType,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { raisesSeverity } from "../integrations/capabilities.ts";
import { spoolName } from "../lib/catalog.ts";
import { dueItems } from "../lib/maintenance.ts";
import { printerTitle } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import { channels, readChannel, sendVia } from "./channels.ts";

const { alerts, integrations, maintenanceTypes, spools, printers, syncPolicies, syncRuns } = schema;
const DAY_MS = 86_400_000;
// ponytail: fixed lead time, make it a preference if anyone asks.
const WARRANTY_LEAD_DAYS = 30;

/**
 * Events, not conditions: raised once by whoever saw them happen (the syncer), keyed by the event
 * (a sync run), so the open-row index never merges two. Evaluate only notifies them and re-arms
 * their snooze; they stay until dismissed.
 * ponytail: dismissed ones are never pruned; delete old dismissed rows if the table grows.
 */
const ONE_SHOT = new Set<AlertKind>(["sync_success", "sync_error"]);

/**
 * Overdue is an error; before that, a warning once a lead is reached: the type's own, else the
 * default from Settings per unit (a type with none of its own also warns when "upcoming"). Each can be off:
 * an overdue item with its error off stays a warning, and none at all if that is off too.
 */
function maintenanceSeverity(
  d: MaintenanceDueItem,
  t: typeof maintenanceTypes.$inferSelect | undefined,
  prefs: {
    maintenanceLeadDays: number;
    maintenanceLeadHours: number;
    maintenanceLeadPrints: number;
  },
): AlertSeverity | null {
  const warn = t?.warnEnabled !== false;
  if (d.progress >= 1) return t?.errorEnabled !== false ? "error" : warn ? "warning" : null;
  if (!warn) return null;
  const set = t && [t.warnLeadDays, t.warnLeadHours, t.warnLeadPrints].some((v) => v != null);
  // Per unit: the type's lead, else the Settings default (hours and prints: 0 = none).
  const days = t?.warnLeadDays ?? prefs.maintenanceLeadDays;
  const hours = t?.warnLeadHours ?? prefs.maintenanceLeadHours;
  const prints = t?.warnLeadPrints ?? prefs.maintenanceLeadPrints;
  const hit =
    (!set && d.status !== "ok") ||
    (d.remainingDays !== null && d.remainingDays <= days) ||
    (hours > 0 && d.remainingSec !== null && d.remainingSec <= hours * 3600) ||
    (prints > 0 && d.remainingPrints !== null && d.remainingPrints <= prints);
  return hit ? "warning" : null;
}

type Ctx = Record<string, string | number>;
/** An alert as its source raises it (ADR-0008). */
export type Raised = {
  kind: AlertKind;
  severity: AlertSeverity;
  module: AlertModule;
  /** Stable key of what raised it: `spool:<id>`, `sync:<integration>:<type>`... */
  task: string;
  entityType: string;
  entityId: string;
  context: Ctx;
  /** Unset = keep what the open alert has. */
  detail?: AlertDetail;
};
type Found = Map<string, Raised>;

/** Events (a sync run's result) are raised here once; conditions come from `evaluateAlerts`. */
export const raise = (db: Db, a: Raised) => db.insert(alerts).values(a).onConflictDoNothing().run();

/** Everything that is wrong right now, keyed like the alerts table's open-row unique index. */
function conditions(db: Db, now: Date): Found {
  const prefs = readPreferences(db);
  const found: Found = new Map();
  const add = (a: Raised) => found.set(`${a.kind}|${a.entityType}|${a.entityId}`, a);

  for (const s of db
    .select({
      id: spools.id,
      grams: spools.remainingGrams,
      lowGrams: spools.lowGrams,
      lowAlert: spools.lowAlert,
      name: spoolName,
    })
    .from(spools)
    .where(and(isNull(spools.archivedAt), ne(spools.status, "empty")))
    .all())
    if (s.lowAlert !== false && s.grams <= (s.lowGrams ?? prefs.lowSpoolGrams))
      add({
        kind: "spool_low",
        severity: "warning",
        module: "filament",
        task: `spool:${s.id}`,
        entityType: "spool",
        entityId: s.id,
        context: { name: s.name, grams: Math.round(s.grams) },
      });

  const types = new Map(
    db
      .select()
      .from(maintenanceTypes)
      .all()
      .map((t) => [t.id, t]),
  );
  for (const d of dueItems(db)) {
    const severity = maintenanceSeverity(d, types.get(d.typeId), prefs);
    if (severity) {
      // Printer or accessory (uuids never clash); `printer` is the target's name for either.
      const key = `${d.targetId}:${d.typeId}`;
      add({
        kind: "maintenance_due",
        // Overdue is an error; the open alert turns into one in place, without a new notification.
        severity,
        module: "maintenance",
        task: `maintenance:${key}`,
        entityType: "maintenance",
        entityId: key,
        context: { printer: d.targetName, task: d.typeName },
      });
    }
  }

  const limit = now.getTime() + WARRANTY_LEAD_DAYS * DAY_MS;
  for (const p of db.select().from(printers).where(isNull(printers.archivedAt)).all()) {
    const ends = p.warrantyEndsAt ? Date.parse(p.warrantyEndsAt) : Number.NaN;
    if (ends >= now.getTime() && ends <= limit)
      add({
        kind: "warranty_ending",
        severity: "warning",
        module: "printers",
        task: `printer:${p.id}`,
        entityType: "printer",
        entityId: p.id,
        context: { name: printerTitle(p), days: Math.ceil((ends - now.getTime()) / DAY_MS) },
      });
  }

  // An auto sync left rows for a person (a print no spool matches, a twin preset...).
  for (const p of db
    .select({ policy: syncPolicies, adapterId: integrations.adapterId })
    .from(syncPolicies)
    .innerJoin(integrations, eq(integrations.id, syncPolicies.integrationId))
    .where(
      and(
        eq(integrations.enabled, true),
        eq(syncPolicies.mode, "auto"),
        gt(syncPolicies.pending, 0),
      ),
    )
    .all()) {
    if (!raisesSeverity(p.policy, "warning")) continue;
    const { integrationId, type, pending } = p.policy;
    const key = `${integrationId}:${type}`;
    // The rows themselves come from the latest run's log; kept as is when it has none (it failed).
    const run = db
      .select({ id: syncRuns.id, log: syncRuns.log })
      .from(syncRuns)
      // Only a sync type has rows pending.
      .where(and(eq(syncRuns.integrationId, integrationId), eq(syncRuns.type, type as SyncType)))
      .orderBy(desc(syncRuns.startedAt))
      .get();
    const left = run?.log.filter((e) => e.event === "left") ?? [];
    add({
      kind: "sync_pending",
      severity: "warning",
      module: "integrations",
      task: `sync:${key}`,
      entityType: "integration",
      entityId: key,
      // `adapterId`: the web shows the adapter's name.
      context: { integrationId, adapterId: p.adapterId, type, count: pending },
      ...(run && left.length && { detail: { runId: run.id, log: left } }),
    });
  }
  return found;
}

// Server-side text for outside channels; the app itself translates by kind + context.
function textOf(a: typeof alerts.$inferSelect): { title: string; body: string } {
  const c = a.context;
  switch (a.kind) {
    case "spool_low":
      return { title: "Spool running low", body: `${c.name}: ${c.grams} g left` };
    case "maintenance_due":
      return {
        title: a.severity === "error" ? "Maintenance overdue" : "Maintenance due soon",
        body: `${c.task} on ${c.printer}`,
      };
    case "warranty_ending":
      return { title: "Warranty ending", body: `${c.name}: ${c.days} days left` };
    case "sync_pending":
      return { title: "Sync needs review", body: `${c.count} ${c.type} waiting for review` };
    case "sync_success":
      return { title: "Sync finished", body: `${c.type}: ${c.created} new, ${c.updated} updated` };
    case "sync_error":
      return { title: "Sync failed", body: `${c.type} could not sync (${c.code})` };
  }
}

const cap = (s: string) => s[0]?.toUpperCase() + s.slice(1);

function lineOf(e: SyncLogEntry): string {
  const label = e.label ?? "(no name)";
  switch (e.event) {
    case "created":
      return `New: ${label}`;
    case "updated":
      return `Updated: ${label}`;
    case "invalid":
      return `Could not be read: ${label}`;
    case "left":
      return `Waits for you: ${label}`;
    case "failed":
      return `Failed: ${e.code ?? "unknown"}`;
    case "truncated":
      return `…and ${e.count} more`;
  }
}

/** Severity, module and the human task come first, then the detail, then the link to the alert. */
function messageOf(a: typeof alerts.$inferSelect, baseUrl?: string): Notification {
  const { title, body } = textOf(a);
  return {
    title,
    body: `${cap(a.severity)} · ${cap(a.module)}\n${body}`,
    ...(a.detail?.log.length && { detail: a.detail.log.map(lineOf) }),
    ...(baseUrl && { url: `${baseUrl}/alerts/${a.id}` }),
  };
}

/**
 * Brings the alerts table in line with reality, then tells the channels about new alerts.
 * One open row per condition (unique index) = it alerts once; it resolves when the condition
 * clears, and a snooze that ended re-arms it if the condition still holds.
 */
export async function evaluateAlerts(
  db: Db,
  key: Buffer,
  log: { warn: (o: object, m: string) => void },
  /** The app's address for links in notifications; none = no links. */
  baseUrl?: string,
  now = new Date(),
) {
  const stamp = now.toISOString();
  const found = conditions(db, now);

  db.transaction((tx) => {
    for (const a of tx.select().from(alerts).where(isNull(alerts.resolvedAt)).all()) {
      const hit = ONE_SHOT.has(a.kind) || found.has(`${a.kind}|${a.entityType}|${a.entityId}`);
      const cur = found.get(`${a.kind}|${a.entityType}|${a.entityId}`);
      // Keep open rows fresh (grams drop, due soon turns overdue) without re-notifying.
      if (cur)
        tx.update(alerts)
          .set({
            context: cur.context,
            severity: cur.severity,
            ...(cur.detail && { detail: cur.detail }),
          })
          .where(eq(alerts.id, a.id))
          .run();
      if (!hit)
        tx.update(alerts)
          .set({ resolvedAt: stamp, updatedAt: stamp })
          .where(eq(alerts.id, a.id))
          .run();
      else if (a.snoozedUntil && a.snoozedUntil <= stamp)
        tx.update(alerts)
          .set({ snoozedUntil: null, notifiedAt: null, readAt: null, updatedAt: stamp })
          .where(eq(alerts.id, a.id))
          .run();
    }
    for (const f of found.values()) tx.insert(alerts).values(f).onConflictDoNothing().run();
  });

  const pending = db
    .select()
    .from(alerts)
    .where(
      and(
        isNull(alerts.resolvedAt),
        isNull(alerts.notifiedAt),
        isNull(alerts.dismissedAt),
        isNull(alerts.snoozedUntil),
      ),
    )
    .all();
  const targets = channels.filter((c) => readChannel(db, key, c.id).enabled);
  for (const a of pending) {
    // Mark first: a slow channel must not let a concurrent run send the same alert twice.
    db.update(alerts).set({ notifiedAt: stamp }).where(eq(alerts.id, a.id)).run();
    const n = messageOf(a, baseUrl);
    for (const c of targets)
      try {
        await sendVia(db, key, c.id, n);
      } catch (e) {
        // ponytail: no retry; a failed delivery is logged and the alert stays in the app.
        log.warn({ err: e, channel: c.id }, "notification failed");
      }
  }
}
