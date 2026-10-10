import type { EnergySource, PrintOutcome } from "@3d-maker-suite/core";
import { count, eq } from "drizzle-orm";
import type { Db } from "./index.ts";
import * as s from "./schema.ts";

const DAY = 86_400_000;

/** Same numbers on every run (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index that must exist (keeps `noUncheckedIndexedAccess` happy without `!`). */
function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`seed: no item at ${i}`);
  return x;
}

/**
 * Fills an empty DB with demo data. Refuses to touch a DB that already has printers.
 * `prints` > 40 spreads that many prints over three years (for load testing).
 */
export function seed(db: Db, now = new Date(), { prints: printCount = 40 } = {}) {
  const [{ n } = { n: 0 }] = db.select({ n: count() }).from(s.printers).all();
  if (n > 0) throw new Error("Database is not empty; refusing to seed.");

  const rand = rng(42);
  const pick = <T>(xs: readonly T[]): T => at(xs, Math.floor(rand() * xs.length));
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

  db.transaction((tx) => {
    tx.insert(s.settings).values({ key: "currency", value: "EUR" }).run();

    const watts = [140, 120];
    const brandId = tx
      .insert(s.brands)
      .values({ name: "Bambu Lab", url: "https://bambulab.com" })
      .returning()
      .get().id;
    const models = ["X1 Carbon", "P1S"].map(
      (model, i) =>
        tx
          .insert(s.printerModels)
          .values({ brandId, model, powerW: at(watts, i) })
          .returning()
          .get().id,
    );
    tx.insert(s.machineProfiles)
      .values({ name: "Bambu Lab X1 Carbon 0.4 nozzle", printerModelId: at(models, 0) })
      .run();
    const printers = [
      {
        name: "Workshop X1C",
        modelId: at(models, 0),
        serial: "00M00A000000001",
        purchasedAt: ago(400),
        purchasePrice: 119900,
        warrantyEndsAt: ago(-330),
      },
      {
        name: "Desk P1S",
        modelId: at(models, 1),
        runtimeOffsetSec: 120 * 3600,
        purchasedAt: ago(200),
        purchasePrice: 59900,
      },
    ].map((v, i) =>
      tx
        .insert(s.printers)
        .values({ ...v, powerW: at(watts, i) })
        .returning()
        .get(),
    );
    tx.insert(s.printerComments)
      .values([
        { printerId: at(printers, 0).id, body: "X axis makes a clicking noise", pinned: true },
        { printerId: at(printers, 0).id, body: "Ordered a new hotend", status: "resolved" },
      ])
      .run();

    const nozzle = tx
      .insert(s.maintenanceTypes)
      .values({ name: "Clean nozzle", intervalPrints: 50 })
      .returning()
      .get();
    const rods = tx
      .insert(s.maintenanceTypes)
      .values({ name: "Lubricate rods", intervalSec: 200 * 3600, intervalDays: 90 })
      .returning()
      .get();

    const filamentBrandId = Object.fromEntries(
      ["Bambu", "Prusament", "Polymaker"].map((name) => [
        name,
        tx.insert(s.filamentBrands).values({ name }).returning().get().id,
      ]),
    );
    const materialId = Object.fromEntries(
      ["PLA", "PETG", "TPU"].map((name) => [
        name,
        tx.insert(s.filamentMaterials).values({ name }).returning().get().id,
      ]),
    );
    const profiles = tx
      .insert(s.filamentProfiles)
      .values([
        {
          brandId: filamentBrandId.Bambu,
          materialId: materialId.PLA,
          name: "Basic",
          densityGcm3: 1.24,
          pricePerKg: 2299,
        },
        {
          brandId: filamentBrandId.Prusament,
          materialId: materialId.PETG,
          name: "PETG",
          densityGcm3: 1.27,
          pricePerKg: 2999,
        },
        {
          brandId: filamentBrandId.Polymaker,
          materialId: materialId.TPU,
          name: "PolyFlex",
          densityGcm3: 1.22,
          pricePerKg: 3999,
        },
      ])
      .returning()
      .all();

    const spools = tx
      .insert(s.spools)
      .values(
        (
          [
            [0, "#1a1a1a"],
            [0, "#1a1a1a"],
            [0, "#f5f5f5"],
            [1, "#2b2b3a"],
            [2, "#c0392b"],
          ] as const
        ).map(([p, colorHex], i) => ({
          profileId: at(profiles, p).id,
          colorHex,
          initialGrams: 1000,
          remainingGrams: 1000,
          pricePaid: at(profiles, p).pricePerKg,
          purchasedAt: ago(150 - i * 10),
          openedAt: ago(130 - i * 10),
          location: i < 3 ? "Dry box A" : "Shelf",
        })),
      )
      .returning()
      .all();
    const remaining = new Map(spools.map((sp) => [sp.id, sp.initialGrams]));

    const projects = tx
      .insert(s.projects)
      .values([
        { name: "Benchy", filePath: "C:/Models/benchy.3mf", meta: { plates: 1 } },
        { name: "Cable clips", filePath: "C:/Models/cable-clips.3mf", meta: { plates: 2 } },
        { name: "Phone stand", sourceUrl: "https://example.com/phone-stand", meta: { plates: 1 } },
      ])
      .returning()
      .all();

    const outcomes: PrintOutcome[] = [
      "success",
      "success",
      "success",
      "success",
      "failed",
      "cancelled",
    ];
    const reasons = ["Spaghetti", "Bed adhesion", "Nozzle clog", "Layer shift"];
    const prints = [];
    const span = printCount > 40 ? 1095 : 120; // days
    for (let i = 0; i < printCount; i++) {
      const p = i % printers.length;
      const durationSec = Math.round((0.5 + rand() * 7.5) * 3600);
      const outcome = pick(outcomes);
      const energySource: EnergySource = rand() < 0.3 ? "measured" : "estimated";
      const estimateWh = (at(watts, p) * durationSec) / 3600;
      const print = tx
        .insert(s.prints)
        .values({
          printerId: at(printers, p).id,
          projectId: rand() < 0.7 ? pick(projects).id : null,
          title: `Demo print ${i + 1}`,
          plate: 1,
          startedAt: ago(span - (i * span) / printCount + rand()),
          durationSec,
          outcome,
          failureReason: outcome === "success" ? null : pick(reasons),
          energyWh: Math.round(
            energySource === "measured" ? estimateWh * (0.85 + rand() * 0.3) : estimateWh,
          ),
          energySource,
        })
        .returning()
        .get();
      prints.push(print);

      // Every 4th print uses two spools (AMS multi-colour).
      const used = i % 4 === 0 ? [at(spools, 0), at(spools, 2)] : [pick(spools)];
      for (const [slot, sp] of used.entries()) {
        const grams = Math.round((durationSec / 3600) * (8 + rand() * 6) * 10) / 10;
        remaining.set(sp.id, (remaining.get(sp.id) ?? 0) - grams);
        tx.insert(s.printFilamentUsages)
          .values({ printId: print.id, spoolId: sp.id, profileId: sp.profileId, grams, slot })
          .run();
      }
    }
    for (const [id, grams] of remaining) {
      tx.update(s.spools)
        .set({ remainingGrams: Math.max(0, Math.round(grams)) })
        .where(eq(s.spools.id, id))
        .run();
    }

    tx.insert(s.maintenanceTasks)
      .values([
        {
          printerId: at(printers, 0).id,
          typeId: nozzle.id,
          doneAt: ago(60),
          printerRuntimeSecAt: 300 * 3600,
          printerPrintsAt: 10,
        },
        {
          printerId: at(printers, 1).id,
          typeId: rods.id,
          doneAt: ago(30),
          printerRuntimeSecAt: 200 * 3600,
          printerPrintsAt: 15,
        },
      ])
      .run();

    const functional = tx
      .insert(s.tags)
      .values({ name: "Functional", color: "#2e86de" })
      .returning()
      .get();
    const gift = tx.insert(s.tags).values({ name: "Gift", color: "#e67e22" }).returning().get();
    tx.insert(s.taggings)
      .values([
        { tagId: functional.id, entityType: "project", entityId: at(projects, 1).id },
        { tagId: gift.id, entityType: "project", entityId: at(projects, 2).id },
        { tagId: gift.id, entityType: "print", entityId: at(prints, 0).id },
        { tagId: functional.id, entityType: "spool", entityId: at(spools, 3).id },
      ])
      .run();
    // Load-test runs: tag a tenth of the prints so tag filters have something to chew on.
    const bulk = prints.filter((_, i) => i % 10 === 5);
    if (printCount > 40)
      for (let i = 0; i < bulk.length; i += 500)
        tx.insert(s.taggings)
          .values(
            bulk
              .slice(i, i + 500)
              .map((p) => ({ tagId: functional.id, entityType: "print" as const, entityId: p.id })),
          )
          .run();

    const desk = tx
      .insert(s.collections)
      .values({ name: "Desk upgrades", description: "Things for the office desk" })
      .returning()
      .get();
    tx.insert(s.collectionProjects)
      .values([
        { collectionId: desk.id, projectId: at(projects, 2).id, position: 0 },
        { collectionId: desk.id, projectId: at(projects, 1).id, position: 1 },
      ])
      .run();
  });
}
