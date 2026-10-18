import type { AlertKind, Notification } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { spoolName } from "../lib/catalog.ts";
import { dueItems } from "../lib/maintenance.ts";
import { printerTitle } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import { channels, readChannel, sendVia } from "./channels.ts";

const { alerts, integrations, spools, printers, syncPolicies } = schema;
const DAY_MS = 86_400_000;
// ponytail: fixed lead time, make it a preference if anyone asks.
const WARRANTY_LEAD_DAYS = 30;

/**
 * Events, not conditions: raised once by whoever saw them happen (the syncer), keyed by the event
 * (a sync run), so the open-row index never merges two. Evaluate only notifies them and re-arms
 * their snooze; they stay until dismissed.
 * ponytail: dismissed ones are never pruned; delete old dismissed rows if the table grows.
 */
const ONE_SHOT = new Set<AlertKind>(["sync_success", "sync_error", "print_failed"]);

type Ctx = Record<string, string | number>;
type Found = Map<string, { kind: AlertKind; entityType: string; entityId: string; context: Ctx }>;

/** Everything that is wrong right now, keyed like the alerts table's open-row unique index. */
function conditions(db: Db, now: Date): Found {
  const prefs = readPreferences(db);
  const found: Found = new Map();
  const add = (kind: AlertKind, entityType: string, entityId: string, context: Ctx) =>
    found.set(`${kind}|${entityType}|${entityId}`, { kind, entityType, entityId, context });

  for (const s of db
    .select({ id: spools.id, grams: spools.remainingGrams, name: spoolName })
    .from(spools)
    .where(and(isNull(spools.archivedAt), ne(spools.status, "empty")))
    .all())
    if (s.grams <= prefs.lowSpoolGrams)
      add("spool_low", "spool", s.id, { name: s.name, grams: Math.round(s.grams) });

  for (const d of dueItems(db))
    if (
      d.status !== "ok" ||
      (d.remainingDays !== null && d.remainingDays <= prefs.maintenanceLeadDays)
    )
      // Printer or accessory (uuids never clash); `printer` is the target's name for either.
      add("maintenance_due", "maintenance", `${d.targetId}:${d.typeId}`, {
        printer: d.targetName,
        task: d.typeName,
        overdue: d.progress >= 1 ? 1 : 0,
      });

  const limit = now.getTime() + WARRANTY_LEAD_DAYS * DAY_MS;
  for (const p of db.select().from(printers).where(isNull(printers.archivedAt)).all()) {
    const ends = p.warrantyEndsAt ? Date.parse(p.warrantyEndsAt) : Number.NaN;
    if (ends >= now.getTime() && ends <= limit)
      add("warranty_ending", "printer", p.id, {
        name: printerTitle(p),
        days: Math.ceil((ends - now.getTime()) / DAY_MS),
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
        eq(syncPolicies.alert, true),
        gt(syncPolicies.pending, 0),
      ),
    )
    .all())
    add("sync_pending", "integration", `${p.policy.integrationId}:${p.policy.type}`, {
      integrationId: p.policy.integrationId,
      adapterId: p.adapterId, // the web shows the adapter's name
      type: p.policy.type,
      count: p.policy.pending,
    });
  return found;
}

// Server-side text for outside channels; the app itself translates by kind + context.
function messageOf(kind: AlertKind, c: Ctx, baseUrl?: string): Notification {
  switch (kind) {
    case "spool_low":
      return { title: "Spool running low", body: `${c.name}: ${c.grams} g left` };
    case "maintenance_due":
      return {
        title: c.overdue ? "Maintenance overdue" : "Maintenance due soon",
        body: `${c.task} on ${c.printer}`,
      };
    case "warranty_ending":
      return { title: "Warranty ending", body: `${c.name}: ${c.days} days left` };
    case "sync_failed":
      // `name` only on alerts from before integrations lost their name (0020).
      return { title: "Sync failed", body: `${c.name ?? "An integration"} could not sync` };
    case "print_failed":
      return { title: "Print failed", body: String(c.title ?? "") };
    case "sync_pending":
      return {
        title: "Sync needs review",
        body: `${c.count} ${c.type} waiting for review`,
        url: baseUrl && `${baseUrl}/import/integration/${c.integrationId}/${c.type}`,
      };
    case "sync_success":
      return { title: "Sync finished", body: `${c.type}: ${c.created} new, ${c.updated} updated` };
    case "sync_error":
      return { title: "Sync failed", body: `${c.type} could not sync (${c.code})` };
  }
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
      // Old `sync_failed` rows (before sync_error) match nothing and resolve here.
      const hit = ONE_SHOT.has(a.kind) || found.has(`${a.kind}|${a.entityType}|${a.entityId}`);
      const cur = found.get(`${a.kind}|${a.entityType}|${a.entityId}`);
      // Keep open rows' text fresh (grams drop, wording changes) without re-notifying.
      if (cur) tx.update(alerts).set({ context: cur.context }).where(eq(alerts.id, a.id)).run();
      if (!hit) tx.update(alerts).set({ resolvedAt: stamp }).where(eq(alerts.id, a.id)).run();
      else if (a.snoozedUntil && a.snoozedUntil <= stamp)
        tx.update(alerts)
          .set({ snoozedUntil: null, notifiedAt: null, readAt: null })
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
    const n = messageOf(a.kind, a.context, baseUrl);
    for (const c of targets)
      try {
        await sendVia(db, key, c.id, n);
      } catch (e) {
        // ponytail: no retry; a failed delivery is logged and the alert stays in the app.
        log.warn({ err: e, channel: c.id }, "notification failed");
      }
  }
}
