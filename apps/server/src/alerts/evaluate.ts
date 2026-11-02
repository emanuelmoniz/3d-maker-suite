import {
  ALERT_KINDS,
  type AlertDetail,
  type AlertKind,
  type AlertModule,
  type AlertSeverity,
  effectiveAlertKinds,
  type MaintenanceDueItem,
  type Notification,
  type SyncLogEntry,
  type SyncType,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { raisesSeverity } from "../integrations/capabilities.ts";
import { alertVisible, hasUsers } from "../lib/auth.ts";
import { spoolName } from "../lib/catalog.ts";
import { dueItems } from "../lib/maintenance.ts";
import { printerTitle } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import { isEnabled, sessionUser } from "../lib/session.ts";
import { own } from "../routes/alerts.ts";
import { STARTED_AT } from "../routes/health.ts";
import { VERSION } from "../updates/updates.ts";
import { channels, destinationsOf, readChannel, sendVia } from "./channels.ts";

const {
  alerts,
  alertStates,
  devices,
  integrations,
  maintenanceTypes,
  spools,
  printers,
  roles,
  syncPolicies,
  syncRuns,
  users,
} = schema;
const DAY_MS = 86_400_000;
// ponytail: fixed lead time, make it a preference if anyone asks.
const WARRANTY_LEAD_DAYS = 30;

/**
 * Events, not conditions: raised once by whoever saw them happen (the syncer), keyed by the event
 * (a sync run), so the open-row index never merges two. Evaluate only notifies them and re-arms
 * their snooze; they stay until dismissed.
 * ponytail: dismissed ones are never pruned; delete old dismissed rows if the table grows.
 */
const ONE_SHOT = new Set<AlertKind>([
  "sync_success",
  "sync_error",
  // Raised by auto slicing, keyed by the file's new bytes.
  "slice_setup_changed",
  "slice_failed",
  // Raised by the update check, one per release; resolved by it (updates/updates.ts).
  "update_available",
  // The same for an installed slicer (integrations/managedSlicer.ts).
  "slicer_update",
  // Raised by an upload that lost to a newer version, keyed by its conflict copy (projects/hubFiles.ts).
  "hub_conflict",
]);

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
      pricePaid: spools.pricePaid,
      openedAt: spools.openedAt,
      status: spools.status,
      name: spoolName,
    })
    .from(spools)
    .where(and(isNull(spools.archivedAt), ne(spools.status, "empty")))
    .all()) {
    const spool = { severity: "warning", module: "filament", task: `spool:${s.id}` } as const;
    const of = { entityType: "spool", entityId: s.id };
    // A spool whose weight isn't known can't be low.
    if (s.grams != null && s.lowAlert !== false && s.grams <= (s.lowGrams ?? prefs.lowSpoolGrams))
      add({
        kind: "spool_low",
        ...spool,
        ...of,
        context: { name: s.name, grams: Math.round(s.grams) },
      });
    // Always checked; who sees them is the subscription, off unless a role opts in (ADR-0016).
    if (s.pricePaid == null)
      add({ kind: "spool_no_price", ...spool, ...of, context: { name: s.name } });
    // A sealed spool has no open date to give.
    if (s.status === "in_use" && !s.openedAt)
      add({ kind: "spool_no_open_date", ...spool, ...of, context: { name: s.name } });
  }

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
  // A connector that opened its stream to this hub (since it started on this version) and is still
  // on another version: its update failed, or it can't update itself (not an installed build).
  if (prefs.hubEnabled)
    for (const d of db.select().from(devices).where(ne(devices.connectorVersion, VERSION)).all()) {
      if (!d.connectorVersion || !d.lastSeenAt || d.lastSeenAt < STARTED_AT) continue;
      add({
        kind: "connector_outdated",
        severity: d.updateFailed ? "error" : "warning",
        module: "hub",
        task: `device:${d.id}`,
        entityType: "device",
        entityId: d.id,
        context: {
          name: d.name,
          version: d.connectorVersion,
          hubVersion: VERSION,
          ...(d.updateFailed && { reason: d.updateFailed.reason }),
          ...(d.updateFailed?.error && { error: d.updateFailed.error }),
        },
      });
    }
  // A device that holds local deletes back (the mass delete guard): open until it reports none.
  if (prefs.hubEnabled)
    for (const d of db.select().from(devices).all()) {
      const held = d.syncState?.held ?? [];
      if (!held.length) continue;
      add({
        kind: "hub_mass_delete",
        severity: "warning",
        module: "hub",
        task: `device:${d.id}`,
        entityType: "device",
        entityId: d.id,
        context: {
          name: d.name,
          roots: held.map((h) => h.name).join(", "),
          count: held.reduce((n, h) => n + h.files, 0),
        },
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
    case "spool_no_price":
      return { title: "Spool has no price", body: `${c.name}: add what you paid for it` };
    case "spool_no_open_date":
      return { title: "Spool has no open date", body: `${c.name}: add the day you opened it` };
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
    case "slice_setup_changed":
      return {
        title: "Print setup needs a look",
        body: `${c.name}: ${c.file} changed its plates or filament slots`,
      };
    case "slice_failed":
      return {
        title: "Auto slice failed",
        body: `${c.name}: plate ${c.plate} of ${c.file} could not be sliced (${c.code})`,
      };
    case "update_available":
      return { title: "Update available", body: `Version ${c.version} is out` };
    case "slicer_update":
      return { title: "Slicer update available", body: `Version ${c.version} can be installed` };
    case "connector_outdated":
      return {
        title: c.reason ? "Connector update failed" : "Connector outdated",
        body: `${c.name}: connector ${c.version}, hub ${c.hubVersion}${c.error ? ` (${c.error})` : ""}`,
      };
    case "hub_conflict":
      return {
        title: "Sync conflict",
        body: `${c.file} changed on the hub and on ${c.device}; their version is ${c.copy}`,
      };
    case "hub_mass_delete":
      return {
        title: "Sync paused: many files deleted",
        body: `${c.name} deleted ${c.count} files in ${c.roots}; confirm or restore them on the device`,
      };
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
    // A user's own snooze ends the same way, for them only: unread and unsent for them again.
    tx.update(alertStates)
      .set({ snoozedUntil: null, readAt: null, notifiedAt: null, updatedAt: stamp })
      .where(lte(alertStates.snoozedUntil, stamp))
      .run();
    for (const f of found.values()) tx.insert(alerts).values(f).onConflictDoNothing().run();
  });

  const targets = new Set(
    channels.filter((c) => readChannel(db, key, c.id).enabled).map((c) => c.id),
  );
  if (hasUsers(db)) {
    if (targets.size) await notifyUsers(db, key, log, targets, now, baseUrl);
    return;
  }

  // No users: the global channels get the kinds the Admin role gets as notify (ADR-0016).
  const admin = db.select().from(roles).where(eq(roles.builtIn, "admin")).get();
  const kinds = effectiveAlertKinds(admin ?? {});
  const pending = db
    .select()
    .from(alerts)
    .where(
      and(
        isNull(alerts.resolvedAt),
        isNull(alerts.notifiedAt),
        isNull(alerts.dismissedAt),
        isNull(alerts.snoozedUntil),
        inArray(
          alerts.kind,
          ALERT_KINDS.filter((k) => kinds[k] === "notify"),
        ),
      ),
    )
    .all();
  for (const a of pending) {
    // Mark first: a slow channel must not let a concurrent run send the same alert twice.
    db.update(alerts).set({ notifiedAt: stamp }).where(eq(alerts.id, a.id)).run();
    const n = messageOf(a, baseUrl);
    for (const id of targets)
      try {
        await sendVia(db, key, id, n);
      } catch (e) {
        // ponytail: no retry; a failed delivery is logged and the alert stays in the app.
        log.warn({ err: e, channel: id }, "notification failed");
      }
  }
}

/**
 * A failing destination waits this long before its next try, so a wrong topic doesn't add a
 * timeout to every check (one runs after each write).
 * ponytail: in memory, a restart retries at once; store a failedAt per channel if that matters.
 */
const RETRY_MS = 15 * 60_000;
const failing = new Map<string, number>();

/**
 * Each alert to every enabled user who gets it as notify, on their own destinations, once per user
 * and channel (ADR-0016). Stamped after the send: the evaluate queue runs one check at a time
 * (app.ts), so nothing else sends it meanwhile, and a channel that failed stays unstamped and retries.
 */
async function notifyUsers(
  db: Db,
  key: Buffer,
  log: { warn: (o: object, m: string) => void },
  targets: Set<string>,
  now: Date,
  baseUrl?: string,
) {
  const stamp = now.toISOString();
  for (const row of db
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .all()
    .filter(isEnabled)) {
    const dests = destinationsOf(key, row.user).filter((d) => targets.has(d.channel));
    if (!dests.length) continue;
    const u = sessionUser(row.user, row.role);
    // In app counts as off here: only the kinds they get as notify.
    const subscriptions = Object.fromEntries(
      ALERT_KINDS.map((k) => [k, u.subscriptions[k] === "notify" ? "notify" : "off"]),
    ) as typeof u.subscriptions;
    const o = own(u.id);
    const pending = db
      .select({ alert: alerts, sent: alertStates.notifiedAt })
      .from(alerts)
      .leftJoin(alertStates, and(eq(alertStates.alertId, alerts.id), eq(alertStates.userId, u.id)))
      .where(
        and(
          isNull(alerts.resolvedAt),
          sql`${o.dismissedAt} IS NULL`,
          sql`${o.snoozedUntil} IS NULL`,
          alertVisible({ ...u, subscriptions }),
        ),
      )
      .orderBy(alerts.createdAt)
      .all();
    for (const { alert, sent } of pending) {
      const next = { ...sent };
      for (const d of dests) {
        const k = `${u.id}:${d.channel}`;
        if (next[d.channel] || (failing.get(k) ?? 0) > now.getTime()) continue;
        try {
          await sendVia(db, key, d.channel, messageOf(alert, baseUrl), d);
          next[d.channel] = stamp;
          failing.delete(k);
        } catch (e) {
          failing.set(k, now.getTime() + RETRY_MS);
          log.warn({ err: e, channel: d.channel, userId: u.id }, "notification failed");
        }
      }
      if (Object.keys(next).length > Object.keys(sent ?? {}).length)
        db.transaction((tx) => {
          // A first state row starts from what they see, like their first PATCH (routes/alerts.ts).
          const cur = tx.select(o).from(alerts).where(eq(alerts.id, alert.id)).get();
          tx.insert(alertStates)
            .values({ alertId: alert.id, userId: u.id, ...cur, notifiedAt: next })
            .onConflictDoUpdate({
              target: [alertStates.alertId, alertStates.userId],
              set: { notifiedAt: next },
            })
            .run();
        });
    }
  }
}
