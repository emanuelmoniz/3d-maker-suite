import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { seed } from "./seed.ts";
export { schema };

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Opens the SQLite file (or `:memory:`), applies pragmas from ADR-0002 and pending migrations. */
export function openDb(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle({ client: sqlite, schema, casing: "snake_case" });
  migrate(db, { migrationsFolder });
  return db;
}

export type Db = ReturnType<typeof openDb>;
