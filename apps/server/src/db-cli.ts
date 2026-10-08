import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb, seed } from "@3d-maker-suite/db";
import { loadConfig } from "./config.ts";

// Usage: tsx src/db-cli.ts migrate|seed  (opening the DB applies pending migrations)
const command = process.argv[2];
if (command !== "migrate" && command !== "seed") {
  console.error("Usage: db-cli migrate|seed");
  process.exit(1);
}

const { dataDir } = loadConfig();
mkdirSync(dataDir, { recursive: true });
const file = join(dataDir, "app.sqlite");
const db = openDb(file);
if (command === "seed") seed(db);
console.log(`${command}: done (${file})`);
