import {
  type CostBreakdown,
  type CostContext,
  type CostRates,
  computeCost,
  estimateEnergyWh,
  maintenancePerHour,
  spoolPricePerKg,
  toMinor,
  wearPerHour,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { inArray, isNull, sql, sum } from "drizzle-orm";
import { profileColumns } from "./catalog.ts";
import { accessoryUsageColumns } from "./maintenance.ts";
import { readPreferences } from "./preferences.ts";

const { printers, prints, maintenanceTasks, spools, filamentProfiles, accessories } = schema;
const { accessoryInstalls } = schema;

export type Rate = { wearPerHour: number; maintenancePerHour: number };
export type DeviceRates = ReturnType<typeof deviceRates>;

/**
 * Wear and maintenance per hour of every printer and of every counted accessory, from today's
 * prices, settings (device value, else the Costs default) and maintenance history. Which
 * accessories a print pays for depends on its date: see `rateAt`.
 */
export function deviceRates(db: Db) {
  const prefs = readPreferences(db);
  const sumBy = (rows: { id: string | null; n: string | null }[]) =>
    new Map(rows.map((r) => [r.id, Number(r.n ?? 0)]));
  const runtime = sumBy(
    db
      .select({ id: prints.printerId, n: sum(prints.durationSec) })
      .from(prints)
      .groupBy(prints.printerId)
      .all(),
  );
  const spent = sumBy(
    db
      .select({ id: maintenanceTasks.printerId, n: sum(maintenanceTasks.cost) })
      .from(maintenanceTasks)
      .groupBy(maintenanceTasks.printerId)
      .all(),
  );
  const spentOnAccessories = sumBy(
    db
      .select({ id: maintenanceTasks.accessoryId, n: sum(maintenanceTasks.cost) })
      .from(maintenanceTasks)
      .groupBy(maintenanceTasks.accessoryId)
      .all(),
  );

  const printerRates = new Map<string, Rate>(
    db
      .select()
      .from(printers)
      .all()
      .map((p) => [
        p.id,
        {
          wearPerHour: wearPerHour(p.purchasePrice, p.lifetimeHours ?? prefs.printerLifetimeHours),
          maintenancePerHour:
            (p.includeMaintenanceCost ?? prefs.includeMaintenanceCost)
              ? maintenancePerHour(
                  spent.get(p.id) ?? 0,
                  p.runtimeOffsetSec + (runtime.get(p.id) ?? 0),
                )
              : 0,
        },
      ]),
  );

  const accessoryRates = new Map<string, Rate>();
  for (const a of db
    .select({
      id: accessories.id,
      purchasePrice: accessories.purchasePrice,
      lifetimeHours: accessories.lifetimeHours,
      includeMaintenanceCost: accessories.includeMaintenanceCost,
      countInCosts: accessories.countInCosts,
      // Qualified: a bare "id" inside the subquery would be the print's.
      runtimeSec: accessoryUsageColumns(sql`${accessories}.${sql.identifier("id")}`).runtimeSec,
    })
    .from(accessories)
    .all()) {
    if (!(a.countInCosts ?? prefs.accessoryCountInCosts)) continue;
    const r = {
      wearPerHour: wearPerHour(a.purchasePrice, a.lifetimeHours ?? prefs.accessoryLifetimeHours),
      maintenancePerHour:
        (a.includeMaintenanceCost ?? prefs.accessoryIncludeMaintenanceCost)
          ? maintenancePerHour(spentOnAccessories.get(a.id) ?? 0, Number(a.runtimeSec))
          : 0,
    };
    if (r.wearPerHour || r.maintenancePerHour) accessoryRates.set(a.id, r);
  }
  const installs = accessoryRates.size
    ? db
        .select()
        .from(accessoryInstalls)
        .where(inArray(accessoryInstalls.accessoryId, [...accessoryRates.keys()]))
        .all()
    : [];

  return { printers: printerRates, accessories: accessoryRates, installs };
}

/**
 * Rates of a print started at `startedAt` on a printer: the printer's plus those of the counted
 * accessories on it then (`[installedAt, removedAt)`, as `accessoryPrints` in maintenance.ts).
 */
export function rateAt(r: DeviceRates, printerId: string, startedAt: string): Rate {
  // Accessories summed first, then the printer: the stats SQL adds in this order (same floats).
  let wear = 0;
  let maint = 0;
  for (const i of r.installs) {
    if (i.printerId !== printerId || startedAt < i.installedAt) continue;
    if (i.removedAt != null && startedAt >= i.removedAt) continue;
    wear += r.accessories.get(i.accessoryId)?.wearPerHour ?? 0;
    maint += r.accessories.get(i.accessoryId)?.maintenancePerHour ?? 0;
  }
  const p = r.printers.get(printerId);
  return {
    wearPerHour: (p?.wearPerHour ?? 0) + wear,
    maintenancePerHour: (p?.maintenancePerHour ?? 0) + maint,
  };
}

/** What the pricing calculator needs: rates, per-printer rates and average filament prices. */
export function costContext(db: Db): CostContext {
  const prefs = readPreferences(db);
  const list = db.select().from(printers).where(isNull(printers.archivedAt)).all();
  const rates = deviceRates(db);
  const now = new Date().toISOString();
  const byMaterial = new Map<string, number[]>();
  for (const p of db
    .select(profileColumns)
    .from(filamentProfiles)
    .where(isNull(filamentProfiles.archivedAt))
    .all()) {
    if (p.pricePerKg == null) continue;
    const key = p.material.toUpperCase();
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), p.pricePerKg]);
  }
  return {
    rates: { energyPerKwh: toMinor(prefs.energyCostPerKwh) },
    quoteDefaults: {
      laborRatePerHour: toMinor(prefs.laborRatePerHour),
      failureMarginPct: prefs.failureMarginPct,
      markupPct: prefs.markupPct,
    },
    printers: list.map((p) => ({
      id: p.id,
      number: p.number as number,
      name: p.name,
      powerW: p.powerW,
      // With the accessories on it now.
      ...rateAt(rates, p.id, now),
    })),
    materialPrices: Object.fromEntries(
      [...byMaterial].map(([m, v]) => [m, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]),
    ),
  };
}

type PrintWithUsages = Pick<
  typeof prints.$inferSelect,
  "id" | "printerId" | "startedAt" | "durationSec" | "energyWh"
> & { usages: { grams: number; spoolId: string | null; profileId: string | null }[] };

/**
 * Cost of each print, with today's prices and rates (and the accessories on its printer when it
 * started). Fetches what the page needs in bulk.
 */
export function printCosts(db: Db, list: PrintWithUsages[]): Map<string, CostBreakdown> {
  const out = new Map<string, CostBreakdown>();
  if (!list.length) return out;
  const prefs = readPreferences(db);
  const ids = <T>(pick: (p: PrintWithUsages) => T[]) => [...new Set(list.flatMap(pick))];
  const printerRows = db
    .select()
    .from(printers)
    .where(
      inArray(
        printers.id,
        ids((p) => [p.printerId]),
      ),
    )
    .all();
  const rates = deviceRates(db);
  const spoolIds = ids((p) => p.usages.flatMap((u) => (u.spoolId ? [u.spoolId] : [])));
  const spoolRows = spoolIds.length
    ? db.select().from(spools).where(inArray(spools.id, spoolIds)).all()
    : [];
  const profileIds = [
    ...new Set([
      ...spoolRows.map((s) => s.profileId),
      ...list.flatMap((p) => p.usages.flatMap((u) => (u.profileId ? [u.profileId] : []))),
    ]),
  ];
  const profiles = new Map(
    (profileIds.length
      ? db
          .select(profileColumns)
          .from(filamentProfiles)
          .where(inArray(filamentProfiles.id, profileIds))
          .all()
      : []
    ).map((p) => [p.id, p]),
  );
  const spoolById = new Map(spoolRows.map((s) => [s.id, s]));
  for (const p of list) {
    const printer = printerRows.find((x) => x.id === p.printerId);
    const costRates: CostRates = {
      energyPerKwh: toMinor(prefs.energyCostPerKwh),
      ...rateAt(rates, p.printerId, p.startedAt),
    };
    out.set(
      p.id,
      computeCost(
        {
          durationSec: p.durationSec,
          energyWh: p.energyWh ?? estimateEnergyWh(printer?.powerW ?? null, p.durationSec),
          filaments: p.usages.map((u) => {
            const spool = u.spoolId ? spoolById.get(u.spoolId) : undefined;
            const profile = profiles.get(u.profileId ?? spool?.profileId ?? "");
            return {
              grams: u.grams,
              pricePerKg: profile
                ? spool
                  ? spoolPricePerKg(spool, profile)
                  : profile.pricePerKg
                : null,
            };
          }),
        },
        costRates,
      ),
    );
  }
  return out;
}
