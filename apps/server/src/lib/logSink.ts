import type { LogLevel, LogModule, Preferences } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { lt, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

const { logs } = schema;

/** Pino level numbers (`success` is our custom one) -> stored level. trace (10) is never kept. */
const LEVELS: Record<number, LogLevel> = {
  20: "debug",
  30: "info",
  35: "success",
  40: "warn",
  50: "error",
  60: "error",
};
export const CUSTOM_LEVELS = { success: 35 };

/** Logs the end of a piece of work at the `success` level (info without the custom level, e.g. tests). */
export function success(log: FastifyBaseLogger, obj: object, msg: string) {
  const l = log as FastifyBaseLogger & { success?: FastifyBaseLogger["info"] };
  (l.success ?? l.info).call(l, obj, msg);
}

/** `/api/<prefix>/...` -> module. Unknown prefixes are `system`. */
const PREFIXES: Record<string, LogModule> = {
  printers: "printers",
  brands: "printers",
  "printer-models": "printers",
  "machine-profiles": "printers",
  accessories: "accessories",
  maintenance: "maintenance",
  filament: "filament",
  "filament-brands": "filament",
  "filament-materials": "filament",
  "print-profiles": "filament",
  projects: "projects",
  prints: "prints",
  costs: "quotes",
  orders: "orders",
  clients: "clients",
  stats: "stats",
  alerts: "alerts",
  import: "import",
  integrations: "integrations",
  "slicer-zip": "integrations",
  backups: "backups",
  preferences: "settings",
  "server-config": "settings",
  branding: "settings",
};
export const moduleOf = (url: string): LogModule =>
  PREFIXES[/^\/api\/([^/?]+)/.exec(url)?.[1] ?? ""] ?? "system";

type Filter = Pick<Preferences, "logActive" | "logLevels" | "logModules">;

/**
 * A pino destination: every line goes to `out` (info and up, as before), and lines that pass
 * the Logs settings are inserted into `logs`. `configure` swaps the settings in memory.
 */
export function createLogSink(db: Db, out: { write(line: string): unknown }) {
  let f: Filter = { logActive: false, logLevels: [], logModules: [] };
  const insert = (line: string) => {
    const {
      level,
      time,
      msg,
      module = "system",
      actor = null,
      pid: _,
      hostname: __,
      ...detail
    } = JSON.parse(line);
    const lvl = LEVELS[level];
    if (!lvl || !f.logLevels.includes(lvl) || !f.logModules.includes(module)) return;
    db.insert(logs)
      .values({
        time: new Date(time).toISOString(),
        level: lvl,
        module,
        actor,
        message: String(msg ?? ""),
        detail: Object.keys(detail).length ? detail : null,
      })
      .run();
  };
  return {
    configure: (p: Filter) => {
      f = p;
    },
    write(line: string) {
      // Pino writes the level first; debug (20) stays out of the console, as before.
      if (!line.startsWith('{"level":2')) out.write(line);
      if (!f.logActive) return;
      try {
        insert(line);
      } catch {
        // Dropped: logging the failure would come straight back here.
      }
    },
  };
}

/** Removes lines older than the retention, then the oldest beyond the max. */
export function pruneLogs(db: Db, p: Pick<Preferences, "logRetentionDays" | "logMaxEntries">) {
  const cutoff = new Date(Date.now() - p.logRetentionDays * 86_400_000).toISOString();
  db.delete(logs).where(lt(logs.time, cutoff)).run();
  db.run(
    sql`DELETE FROM logs WHERE id <= (SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET ${p.logMaxEntries})`,
  );
}
