import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb, seed } from "@3d-maker-suite/db";
import { loadConfig } from "./config.ts";

// Usage: tsx src/db-cli.ts migrate|seed [--prints=10000]  (opening the DB applies pending migrations)
const command = process.argv[2];
if (command !== "migrate" && command !== "seed") {
  console.error("Usage: db-cli migrate|seed [--prints=N]");
  process.exit(1);
}
const prints = Number(process.argv.find((a) => a.startsWith("--prints="))?.slice(9)) || undefined;

const { dataDir } = loadConfig();
mkdirSync(dataDir, { recursive: true });
const file = join(dataDir, "app.sqlite");
const db = openDb(file);
if (command === "seed") seed(db, new Date(), { prints });
console.log(`${command}: done (${file})`);
