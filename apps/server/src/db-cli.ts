import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb, schema, seed } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { loadConfig } from "./config.ts";
import { hashPassword } from "./lib/password.ts";
import { endUserSessions } from "./lib/session.ts";

// Usage: tsx src/db-cli.ts migrate|seed [--prints=10000]  (opening the DB applies pending migrations)
//        tsx src/db-cli.ts reset-password <email>  (lost password, ADR-0012: shell access is already full access)
const command = process.argv[2];
if (command !== "migrate" && command !== "seed" && command !== "reset-password") {
  console.error("Usage: db-cli migrate|seed [--prints=N] | reset-password <email>");
  process.exit(1);
}
const prints = Number(process.argv.find((a) => a.startsWith("--prints="))?.slice(9)) || undefined;

const { dataDir } = loadConfig();
mkdirSync(dataDir, { recursive: true });
const file = join(dataDir, "app.sqlite");
const db = openDb(file);
if (command === "seed") seed(db, new Date(), { prints });
if (command === "reset-password") {
  const email = process.argv[3]?.trim().toLowerCase() ?? "";
  const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (!user) {
    console.error(`No user with the email "${email}"`);
    process.exit(1);
  }
  // Printed, not passed as an argument, so it never lands in the shell history.
  const password = randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(password);
  db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id)).run();
  endUserSessions(db, user.id);
  console.log(`New password for ${user.email}: ${password}  (change it after signing in)`);
}
console.log(`${command}: done (${file})`);
