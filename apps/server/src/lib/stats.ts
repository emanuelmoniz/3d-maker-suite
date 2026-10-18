import { type Stats, type StatsQuery, toMinor } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, inArray, type SQL, sql } from "drizzle-orm";
import { printerLabel, profileLabel, projectLabel } from "./catalog.ts";
import { deviceRates, type Rate } from "./cost.ts";
import { dateRange, inIds, taggedWith } from "./list.ts";
import { readPreferences } from "./preferences.ts";

const { prints, printFilamentUsages: usages } = schema;

// Same cost rules as `printCosts` (lib/cost.ts), but computed by SQLite: one row per print with
// each line rounded on its own, then summed per group. Nothing is loaded into JS but the result.
const metrics = sql.raw(`
  COUNT(*) AS prints,
  COALESCE(SUM(outcome = 'success'), 0) AS successes,
  COALESCE(SUM(sec), 0) AS seconds,
  COALESCE(SUM(est_sec), 0) AS estimatedSeconds,
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
  const rates = deviceRates(db);
  // `('', 0, 0)` keeps VALUES valid when a map is empty.
  const rateRows = (m: Map<string, Rate>) =>
    sql.join(
      [
        sql`('', 0, 0)`,
        ...[...m].map(([id, r]) => sql`(${id}, ${r.wearPerHour}, ${r.maintenancePerHour})`),
      ],
      sql`, `,
    );
  const list = (ids: string[]) =>
    sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
  // A usage's material is its profile's (the spool's profile when the usage has none).
  const usageMaterial = sql`(SELECT fp.material_id FROM filament_profiles fp
    WHERE fp.id = COALESCE(us.profile_id, (SELECT sp.profile_id FROM spools sp WHERE sp.id = us.spool_id)))`;
  const where: SQL | undefined = and(
    dateRange(prints.startedAt, q),
    inIds(prints.printerId, q.printerId),
    inIds(prints.projectId, q.projectId),
    inIds(prints.outcome, q.outcome),
    taggedWith(db, "print", prints.id, q.tagId),
    q.spoolId &&
      inArray(
        prints.id,
        db.select({ id: usages.printId }).from(usages).where(inArray(usages.spoolId, q.spoolId)),
      ),
    q.materialId &&
      sql`${prints.id} IN (SELECT us.print_id FROM print_filament_usages us
        WHERE ${usageMaterial} IN (${list(q.materialId)}))`,
  );

  // With a spool/material filter only the matching usages count: their grams, and their share (by
  // grams) of the print's time, energy, wear and maintenance. Without one every usage is a hit.
  const hit = and(
    q.spoolId && sql`us.spool_id IN (${list(q.spoolId)})`,
    q.materialId && sql`${usageMaterial} IN (${list(q.materialId)})`,
  );
  // A print's wear/maintenance rate: its printer's plus the counted accessories' on it when it
  // started (`rateAt` in lib/cost.ts).
  const cte = sql`
    WITH rate(printer_id, wear, maint) AS (VALUES ${rateRows(rates.printers)}),
    acc(accessory_id, wear, maint) AS (VALUES ${rateRows(rates.accessories)}),
    sel AS (SELECT prints.id FROM prints WHERE ${where ?? sql`1`}),
    ar AS (
      SELECT p.id, SUM(acc.wear) AS wear, SUM(acc.maint) AS maint
      FROM sel JOIN prints p ON p.id = sel.id
      JOIN accessory_installs i ON i.printer_id = p.printer_id AND p.started_at >= i.installed_at
        AND (i.removed_at IS NULL OR p.started_at < i.removed_at)
      JOIN acc ON acc.accessory_id = i.accessory_id
      GROUP BY p.id),
    use AS (
      SELECT us.print_id, us.grams, COALESCE(us.profile_id, sp.profile_id) AS profile_id,
        COALESCE(NULLIF(sp.color_name, ''), sp.color_hex, us.color_hex) AS color,
        CASE WHEN sp.price_paid IS NOT NULL AND sp.initial_grams > 0
          THEN sp.price_paid * 1000.0 / sp.initial_grams ELSE fp.price_per_kg END AS price,
        COALESCE(us.grams / NULLIF(SUM(us.grams) OVER (PARTITION BY us.print_id), 0),
          1.0 / COUNT(*) OVER (PARTITION BY us.print_id)) AS w,
        ${hit ?? sql`1`} AS hit
      FROM print_filament_usages us
      LEFT JOIN spools sp ON sp.id = us.spool_id
      LEFT JOIN filament_profiles fp ON fp.id = COALESCE(us.profile_id, sp.profile_id)
      WHERE us.print_id IN (SELECT id FROM sel)),
    fil AS (
      SELECT print_id, SUM(grams) AS grams,
        SUM(CASE WHEN price IS NULL THEN grams ELSE 0 END) AS unpriced,
        SUM(grams / 1000.0 * price) AS material,
        SUM(w) AS share
      FROM use WHERE hit GROUP BY print_id),
    base AS (
      SELECT prints.*, ${hit ? sql`COALESCE(fil.share, 0)` : sql`1`} AS share,
        COALESCE(prints.energy_wh, printers.power_w * prints.duration_sec / 3600.0, 0) AS wh0,
        COALESCE(fil.grams, 0) AS fil_grams, COALESCE(fil.unpriced, 0) AS fil_unpriced,
        COALESCE(fil.material, 0) AS fil_material,
        rate.wear + COALESCE(ar.wear, 0) AS wear_rate, rate.maint + COALESCE(ar.maint, 0) AS maint_rate
      FROM sel
      JOIN prints ON prints.id = sel.id
      JOIN printers ON printers.id = prints.printer_id
      JOIN rate ON rate.printer_id = prints.printer_id
      LEFT JOIN ar ON ar.id = prints.id
      LEFT JOIN fil ON fil.print_id = prints.id),
    pc AS (
      SELECT id, started_at, printer_id, project_id, outcome, share,
        CAST(ROUND(COALESCE(duration_sec, 0) * share) AS INTEGER) AS sec,
        CASE WHEN duration_estimated THEN CAST(ROUND(COALESCE(duration_sec, 0) * share) AS INTEGER)
          ELSE 0 END AS est_sec,
        wh0 * share AS wh,
        fil_grams AS grams,
        fil_unpriced AS unpriced,
        CAST(ROUND(fil_material) AS INTEGER) AS material,
        CAST(ROUND(wh0 * share / 1000.0 * ${toMinor(prefs.energyCostPerKwh)}) AS INTEGER) AS energy,
        CAST(ROUND(COALESCE(duration_sec, 0) * share / 3600.0 * wear_rate) AS INTEGER) AS wear,
        CAST(ROUND(COALESCE(duration_sec, 0) * share / 3600.0 * maint_rate) AS INTEGER) AS maint
      FROM base)`;

  const all = <T>(select: SQL) => db.all<T>(sql`${cte} ${select}`);
  const grouped = (key: SQL, label: SQL, join: SQL) =>
    all<Stats["breakdowns"]["printer"][number]>(
      sql`SELECT ${key} AS key, ${label} AS label, ${metrics} FROM pc ${join}
          GROUP BY key ORDER BY total DESC, prints DESC`,
    );

  const [totals] = all<Stats["totals"]>(sql`SELECT ${metrics} FROM pc`);
  return {
    totals: totals as Stats["totals"],
    series: fillGaps(
      all<Stats["series"][number]>(
        sql`SELECT ${sql.raw(BUCKET[q.bucket])} AS key, ${metrics} FROM pc GROUP BY key ORDER BY key`,
      ),
      q.bucket,
    ),
    breakdowns: {
      printer: grouped(
        sql`pc.printer_id`,
        printerLabel,
        sql`JOIN printers ON printers.id = pc.printer_id`,
      ),
      project: grouped(
        sql`pc.project_id`,
        projectLabel,
        sql`LEFT JOIN projects ON projects.id = pc.project_id`,
      ),
      outcome: grouped(sql`pc.outcome`, sql`pc.outcome`, sql``),
      // Each usage takes its grams' part (w / share) of the print's already filtered lines.
      filament: all<Stats["breakdowns"]["filament"][number]>(
        sql`SELECT *, material + energy + wear + maintenance AS total FROM (
              SELECT use.profile_id || '|' || COALESCE(use.color, '') AS key,
                trim(COALESCE(${profileLabel}, '') || ' ' || COALESCE(use.color, '')) AS label,
                COUNT(DISTINCT use.print_id) AS prints,
                COUNT(DISTINCT CASE WHEN pc.outcome = 'success' THEN pc.id END) AS successes,
                CAST(ROUND(SUM(pc.sec * use.w / pc.share)) AS INTEGER) AS seconds,
                CAST(ROUND(SUM(pc.est_sec * use.w / pc.share)) AS INTEGER) AS estimatedSeconds,
                SUM(pc.wh * use.w / pc.share) AS energyWh,
                SUM(use.grams) AS grams,
                SUM(CASE WHEN use.price IS NULL THEN use.grams ELSE 0 END) AS unpricedGrams,
                CAST(ROUND(COALESCE(SUM(use.grams / 1000.0 * use.price), 0)) AS INTEGER) AS material,
                CAST(ROUND(SUM(pc.energy * use.w / pc.share)) AS INTEGER) AS energy,
                CAST(ROUND(SUM(pc.wear * use.w / pc.share)) AS INTEGER) AS wear,
                CAST(ROUND(SUM(pc.maint * use.w / pc.share)) AS INTEGER) AS maintenance
              FROM use JOIN pc ON pc.id = use.print_id
              LEFT JOIN filament_profiles ON filament_profiles.id = use.profile_id
              WHERE use.hit
              GROUP BY key)
            ORDER BY total DESC, grams DESC`,
      ),
    },
  };
}

const ZERO = {
  prints: 0,
  successes: 0,
  seconds: 0,
  estimatedSeconds: 0,
  energyWh: 0,
  grams: 0,
  unpricedGrams: 0,
  material: 0,
  energy: 0,
  wear: 0,
  maintenance: 0,
  total: 0,
};

/** The bucket after `key` (a yyyy-mm-dd first day, UTC). */
function nextBucket(key: string, bucket: StatsQuery["bucket"]) {
  const d = new Date(`${key}T00:00:00Z`);
  if (bucket === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + (bucket === "week" ? 7 : 1));
  return d.toISOString().slice(0, 10);
}

/** Adds zero rows for the empty buckets between the first and the last, so time stays to scale. */
function fillGaps(rows: Stats["series"], bucket: StatsQuery["bucket"]): Stats["series"] {
  const out: Stats["series"] = [];
  for (const r of rows) {
    const prev = out.at(-1);
    if (prev)
      for (let k = nextBucket(prev.key, bucket); k < r.key; k = nextBucket(k, bucket))
        out.push({ ...ZERO, key: k });
    out.push(r);
  }
  return out;
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
