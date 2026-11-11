import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_ROLE_IDS } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { hashPassword } from "./lib/password.ts";

/**
 * A real 5.1.0 database to run on, when given: `REAL_DB=/path/app.sqlite pnpm vitest run <file>`.
 * Never committed, and CI runs the same tests on rows the test makes. The file itself is only read.
 * Not imported by the app: only tests and `testRealSetup.ts`.
 */
export const REAL_DB = process.env.REAL_DB;

/** Copies the database, with its WAL when it has one. */
export function copyDb(from: string, to: string) {
  copyFileSync(from, to);
  if (existsSync(`${from}-wal`)) copyFileSync(`${from}-wal`, `${to}-wal`);
}

/**
 * Real data points at real things: alerts would mail its owner and a project delete would remove
 * its real, possibly empty, folder. Delivery goes, and every root moves under `dir`.
 */
export function sterilize(db: ReturnType<typeof openDb>, dir: string) {
  const sqlite = db.$client;
  sqlite.prepare("DELETE FROM settings WHERE key LIKE 'channel:%'").run();
  sqlite.prepare("UPDATE users SET delivery = '{}'").run();
  const roots = sqlite.prepare("SELECT id FROM roots").all() as { id: string }[];
  roots.forEach((r, i) => {
    sqlite.prepare("UPDATE roots SET path = ? WHERE id = ?").run(join(dir, `root-${i}`), r.id);
  });
}

/** Nothing leaves this machine: a test that tries fails on it. */
export function blockNetwork() {
  globalThis.fetch = async (url: unknown) => {
    throw new Error(`network call in a test: ${String(url)}`);
  };
}

export const PW = "password123";
/** The sign-in of a test user, by name. */
export const emailOf = (name: string) => `release-${name}@x.io`;

/** Adds a user of the Editor role with these permissions (none of the real ones can sign in). */
export async function addUser(
  db: ReturnType<typeof openDb>,
  name: string,
  permissions: Record<string, string>,
  roleId: string = BUILT_IN_ROLE_IDS.editor,
) {
  return db
    .insert(schema.users)
    .values({
      email: emailOf(name),
      displayName: name,
      roleId,
      passwordHash: await hashPassword(PW),
      permissions,
    })
    .returning()
    .get();
}

/** Adds the user and signs them in. */
export async function signedIn(
  db: ReturnType<typeof openDb>,
  app: { inject: (o: object) => Promise<{ headers: Record<string, unknown>; body: string }> },
  name: string,
  permissions: Record<string, string>,
  roleId?: string,
) {
  const user = await addUser(db, name, permissions, roleId);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: user.email, password: PW },
  });
  const cookie = String(res.headers["set-cookie"]).split(";")[0] ?? "";
  if (!cookie.includes("=")) throw new Error(`no session for ${name}: ${res.body}`);
  return { user, cookie };
}

/** The permissions of a user who has this level on every module. */
export const everyModule = (level: string) =>
  Object.fromEntries(
    ["printers", "maintenance", "filament", "projects", "prints", "costs", "catalog"].map((m) => [
      m,
      level,
    ]),
  );

/**
 * A data folder holding a sterile copy of `from`, with an admin, a manager and a writer to sign in
 * as. For a real server process: its schedulers run, so no integration may stay on.
 */
export async function prepareDataDir(from: string, dataDir: string) {
  copyDb(from, join(dataDir, "app.sqlite"));
  const db = openDb(join(dataDir, "app.sqlite"));
  sterilize(db, join(dataDir, "roots"));
  db.$client.prepare("UPDATE integrations SET enabled = 0").run();
  await addUser(db, "admin", {}, BUILT_IN_ROLE_IDS.admin);
  await addUser(db, "manager", everyModule("manage"));
  await addUser(db, "writer", everyModule("write"));
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
  db.$client.close();
}
