import { type Stats, type StatsQuery, toMinor } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, inArray, type SQL, sql } from "drizzle-orm";
import { printerRates } from "./cost.ts";
import { dateRange, inIds, taggedWith } from "./list.ts";
import { readPreferences } from "./preferences.ts";

const { prints, printers, printFilamentUsages: usages } = schema;

// Same cost rules as `printCosts` (lib/cost.ts), but computed by SQLite: one row per print with
// each line rounded on its own, then summed per group. Nothing is loaded into JS but the result.
const metrics = sql.raw(`
  COUNT(*) AS prints,
  COALESCE(SUM(outcome = 'success'), 0) AS successes,
  COALESCE(SUM(sec), 0) AS seconds,
  COALESCE(SUM(wh), 0) AS energyWh,
  COALESCE(SUM(grams), 0) AS grams,
  COALESCE(SUM(unpriced), 0) AS unpricedGrams,
  COALESCE(SUM(material), 0) AS material,
  COALESCE(SUM(energy), 0) AS energy,
  COALESCE(SUM(wear), 0) AS wear,
  COALESCE(SUM(maint), 0) AS maintenance,
  COALESCE(SUM(material + energy + wear + maint), 0) AS total`);

// ponytail: buckets are UTC days (weeks start on Monday). Add a timezone offset if it matters.
const BUCKET = {
  day: "substr(started_at, 1, 10)",
  week: "date(started_at, 'weekday 0', '-6 days')",
  month: "substr(started_at, 1, 7) || '-01'",
} as const;

export function readStats(db: Db, q: StatsQuery): Stats {
  const prefs = readPreferences(db);
  const rates = printerRates(db, db.select().from(printers).all());
  const rateRows = sql.join(
    [...rates].map(([id, r]) => sql`(${id}, ${r.wearPerHour}, ${r.maintenancePerHour})`),
    sql`, `,
  );
  const using = (column: typeof usages.spoolId | typeof usages.profileId, ids?: string[]) =>
    ids
      ? inArray(
          prints.id,
          db.select({ id: usages.printId }).from(usages).where(inArray(column, ids)),
        )
      : undefined;
  const where: SQL | undefined = and(
    dateRange(prints.startedAt, q),
    inIds(prints.printerId, q.printerId),
    inIds(prints.projectId, q.projectId),
    inIds(prints.outcome, q.outcome),
    taggedWith(db, "print", prints.id, q.tagId),
    using(usages.spoolId, q.spoolId),
    using(usages.profileId, q.profileId),
  );

  const cte = sql`
    WITH rate(printer_id, wear, maint) AS (VALUES ('', 0, 0), ${rateRows}),
    sel AS (SELECT prints.id FROM prints WHERE ${where ?? sql`1`}),
    use AS (
      SELECT us.print_id, us.grams, COALESCE(us.profile_id, sp.profile_id) AS profile_id,
        CASE WHEN sp.price_paid IS NOT NULL AND sp.initial_grams > 0
          THEN sp.price_paid * 1000.0 / sp.initial_grams ELSE fp.price_per_kg END AS price
      FROM print_filament_usages us
      LEFT JOIN spools sp ON sp.id = us.spool_id
      LEFT JOIN filament_profiles fp ON fp.id = COALESCE(us.profile_id, sp.profile_id)
      WHERE us.print_id IN (SELECT id FROM sel)),
    fil AS (
      SELECT print_id, SUM(grams) AS grams,
        SUM(CASE WHEN price IS NULL THEN grams ELSE 0 END) AS unpriced,
        SUM(grams / 1000.0 * price) AS material
      FROM use GROUP BY print_id),
    pc AS (
      SELECT prints.id, prints.started_at, prints.printer_id, prints.project_id, prints.outcome,
        COALESCE(prints.duration_sec, 0) AS sec,
        COALESCE(prints.energy_wh, printers.power_w * prints.duration_sec / 3600.0, 0) AS wh,
        COALESCE(fil.grams, 0) AS grams,
        COALESCE(fil.unpriced, 0) AS unpriced,
        CAST(ROUND(COALESCE(fil.material, 0)) AS INTEGER) AS material,
        CAST(ROUND(COALESCE(prints.energy_wh, printers.power_w * prints.duration_sec / 3600.0, 0)
          / 1000.0 * ${toMinor(prefs.energyCostPerKwh)}) AS INTEGER) AS energy,
        CAST(ROUND(COALESCE(prints.duration_sec, 0) / 3600.0 * rate.wear) AS INTEGER) AS wear,
        CAST(ROUND(COALESCE(prints.duration_sec, 0) / 3600.0 * rate.maint) AS INTEGER) AS maint
      FROM sel
      JOIN prints ON prints.id = sel.id
      JOIN printers ON printers.id = prints.printer_id
      JOIN rate ON rate.printer_id = prints.printer_id
      LEFT JOIN fil ON fil.print_id = prints.id)`;

  const all = <T>(select: SQL) => db.all<T>(sql`${cte} ${select}`);
  const grouped = (key: SQL, label: SQL, join: SQL) =>
    all<Stats["breakdowns"]["printer"][number]>(
      sql`SELECT ${key} AS key, ${label} AS label, ${metrics} FROM pc ${join}
          GROUP BY key ORDER BY total DESC, prints DESC`,
    );

  const [totals] = all<Stats["totals"]>(sql`SELECT ${metrics} FROM pc`);
  return {
    totals: totals as Stats["totals"],
    series: all<Stats["series"][number]>(
      sql`SELECT ${sql.raw(BUCKET[q.bucket])} AS key, ${metrics} FROM pc GROUP BY key ORDER BY key`,
    ),
    breakdowns: {
      printer: grouped(
        sql`pc.printer_id`,
        sql`printers.name`,
        sql`JOIN printers ON printers.id = pc.printer_id`,
      ),
      project: grouped(
        sql`pc.project_id`,
        sql`projects.name`,
        sql`LEFT JOIN projects ON projects.id = pc.project_id`,
      ),
      outcome: grouped(sql`pc.outcome`, sql`pc.outcome`, sql``),
      filament: all<Stats["breakdowns"]["filament"][number]>(
        sql`SELECT use.profile_id AS key,
              trim(filament_profiles.brand || ' ' || filament_profiles.material || ' ' || filament_profiles.name) AS label,
              filament_profiles.color_hex AS colorHex,
              COUNT(DISTINCT use.print_id) AS prints, 0 AS successes, 0 AS seconds, 0 AS energyWh,
              SUM(use.grams) AS grams,
              SUM(CASE WHEN use.price IS NULL THEN use.grams ELSE 0 END) AS unpricedGrams,
              CAST(ROUND(COALESCE(SUM(use.grams / 1000.0 * use.price), 0)) AS INTEGER) AS material,
              0 AS energy, 0 AS wear, 0 AS maintenance,
              CAST(ROUND(COALESCE(SUM(use.grams / 1000.0 * use.price), 0)) AS INTEGER) AS total
            FROM use LEFT JOIN filament_profiles ON filament_profiles.id = use.profile_id
            GROUP BY key ORDER BY total DESC, grams DESC`,
      ),
    },
  };
}

const csv = (v: string | number) =>
  /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v);

/** The series of the current view, one row per bucket. Money in major units, time in hours. */
export function statsCsv(s: Stats): string {
  const head = [
    "date",
    "prints",
    "successes",
    "hours",
    "energy_kwh",
    "filament_g",
    "material",
    "energy",
    "wear",
    "maintenance",
    "total",
  ];
  const money = (n: number) => (n / 100).toFixed(2);
  const rows = [...s.series, { ...s.totals, key: "total" }].map((r) =>
    [
      r.key,
      r.prints,
      r.successes,
      (r.seconds / 3600).toFixed(2),
      (r.energyWh / 1000).toFixed(3),
      r.grams.toFixed(1),
      money(r.material),
      money(r.energy),
      money(r.wear),
      money(r.maintenance),
      money(r.total),
    ]
      .map(csv)
      .join(","),
  );
  return `${[head.join(","), ...rows].join("\n")}\n`;
}
