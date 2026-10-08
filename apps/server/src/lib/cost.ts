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
import { inArray, isNull, sum } from "drizzle-orm";
import { readPreferences } from "./preferences.ts";

const { printers, prints, maintenanceTasks, spools, filamentProfiles } = schema;

type PrinterRow = typeof printers.$inferSelect;

/** Wear and maintenance per hour for each printer, from the preferences and its history. */
function printerRates(db: Db, list: PrinterRow[]) {
  const prefs = readPreferences(db);
  const runtime = new Map(
    db
      .select({ id: prints.printerId, sec: sum(prints.durationSec) })
      .from(prints)
      .groupBy(prints.printerId)
      .all()
      .map((r) => [r.id, Number(r.sec ?? 0)]),
  );
  const spent = new Map(
    db
      .select({ id: maintenanceTasks.printerId, cost: sum(maintenanceTasks.cost) })
      .from(maintenanceTasks)
      .groupBy(maintenanceTasks.printerId)
      .all()
      .map((r) => [r.id, Number(r.cost ?? 0)]),
  );
  return new Map(
    list.map((p) => [
      p.id,
      {
        wearPerHour: wearPerHour(p.purchasePrice, prefs.printerLifetimeHours),
        maintenancePerHour: prefs.includeMaintenanceCost
          ? maintenancePerHour(spent.get(p.id) ?? 0, p.runtimeOffsetSec + (runtime.get(p.id) ?? 0))
          : 0,
      },
    ]),
  );
}

/** What the pricing calculator needs: rates, per-printer rates and average filament prices. */
export function costContext(db: Db): CostContext {
  const prefs = readPreferences(db);
  const list = db.select().from(printers).where(isNull(printers.archivedAt)).all();
  const rates = printerRates(db, list);
  const byMaterial = new Map<string, number[]>();
  for (const p of db
    .select()
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
      name: p.name,
      powerW: p.powerW,
      ...(rates.get(p.id) as { wearPerHour: number; maintenancePerHour: number }),
    })),
    materialPrices: Object.fromEntries(
      [...byMaterial].map(([m, v]) => [m, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]),
    ),
  };
}

type PrintWithUsages = Pick<
  typeof prints.$inferSelect,
  "id" | "printerId" | "durationSec" | "energyWh"
> & { usages: { grams: number; spoolId: string | null; profileId: string | null }[] };

/** Cost of each print, with today's prices and rates. Fetches what the page needs in bulk. */
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
  const rates = printerRates(db, printerRows);
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
      ? db.select().from(filamentProfiles).where(inArray(filamentProfiles.id, profileIds)).all()
      : []
    ).map((p) => [p.id, p]),
  );
  const spoolById = new Map(spoolRows.map((s) => [s.id, s]));
  for (const p of list) {
    const printer = printerRows.find((x) => x.id === p.printerId);
    const r = rates.get(p.printerId);
    const costRates: CostRates = {
      energyPerKwh: toMinor(prefs.energyCostPerKwh),
      wearPerHour: r?.wearPerHour ?? 0,
      maintenancePerHour: r?.maintenancePerHour ?? 0,
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
