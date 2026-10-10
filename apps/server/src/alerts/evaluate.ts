import type { AlertKind, Notification } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull, ne } from "drizzle-orm";
import { profileBrand, profileMaterial } from "../lib/catalog.ts";
import { dueItems } from "../lib/maintenance.ts";
import { readPreferences } from "../lib/preferences.ts";
import { channels, readChannel, sendVia } from "./channels.ts";

const { alerts, spools, filamentProfiles, printers } = schema;
const DAY_MS = 86_400_000;
// ponytail: fixed lead time, make it a preference if anyone asks.
const WARRANTY_LEAD_DAYS = 30;

type Ctx = Record<string, string | number>;
type Found = Map<string, { kind: AlertKind; entityType: string; entityId: string; context: Ctx }>;

/** Everything that is wrong right now, keyed like the alerts table's open-row unique index. */
function conditions(db: Db, now: Date): Found {
  const prefs = readPreferences(db);
  const found: Found = new Map();
  const add = (kind: AlertKind, entityType: string, entityId: string, context: Ctx) =>
    found.set(`${kind}|${entityType}|${entityId}`, { kind, entityType, entityId, context });

  for (const s of db
    .select({
      id: spools.id,
      grams: spools.remainingGrams,
      brand: profileBrand,
      material: profileMaterial,
      name: filamentProfiles.name,
    })
    .from(spools)
    .innerJoin(filamentProfiles, eq(filamentProfiles.id, spools.profileId))
    .where(and(isNull(spools.archivedAt), ne(spools.status, "empty")))
    .all())
    if (s.grams <= prefs.lowSpoolGrams)
      add("spool_low", "spool", s.id, {
        name: [s.brand, s.material, s.name].filter(Boolean).join(" "),
        grams: Math.round(s.grams),
      });

  for (const d of dueItems(db))
    if (
      d.status !== "ok" ||
      (d.remainingDays !== null && d.remainingDays <= prefs.maintenanceLeadDays)
    )
      add("maintenance_due", "maintenance", `${d.printerId}:${d.typeId}`, {
        printer: d.printerName,
        task: d.typeName,
        overdue: d.progress >= 1 ? 1 : 0,
      });

  const limit = now.getTime() + WARRANTY_LEAD_DAYS * DAY_MS;
  for (const p of db.select().from(printers).where(isNull(printers.archivedAt)).all()) {
    const ends = p.warrantyEndsAt ? Date.parse(p.warrantyEndsAt) : Number.NaN;
    if (ends >= now.getTime() && ends <= limit)
      add("warranty_ending", "printer", p.id, {
        name: p.name,
        days: Math.ceil((ends - now.getTime()) / DAY_MS),
      });
  }
  return found;
}

// Server-side text for outside channels; the app itself translates by kind + context.
function messageOf(kind: AlertKind, c: Ctx): Notification {
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
  now = new Date(),
) {
  const stamp = now.toISOString();
  const found = conditions(db, now);

  db.transaction((tx) => {
    for (const a of tx.select().from(alerts).where(isNull(alerts.resolvedAt)).all()) {
      // The syncer raises and resolves sync_failed itself; here it only gets its snooze re-armed.
      const hit = a.kind === "sync_failed" || found.has(`${a.kind}|${a.entityType}|${a.entityId}`);
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
    const n = messageOf(a.kind, a.context);
    for (const c of targets)
      try {
        await sendVia(db, key, c.id, n);
      } catch (e) {
        // ponytail: no retry; a failed delivery is logged and the alert stays in the app.
        log.warn({ err: e, channel: c.id }, "notification failed");
      }
  }
}
