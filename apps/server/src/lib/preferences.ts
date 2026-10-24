import { PREFERENCE_DEFAULTS, type Preferences, preferencesSchema } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";

// ponytail: pnpm names the running script; `pnpm dev` logs by default, `pnpm start` doesn't.
const DEFAULTS = {
  ...PREFERENCE_DEFAULTS,
  logActive: process.env.npm_lifecycle_event === "dev",
};

const { settings, userSettings } = schema;
const entries = (rows: { key: string; value: unknown }[]) =>
  Object.fromEntries(rows.map((r) => [r.key, r.value]));

/** Stored rows over the defaults, and the user's own display keys over those (ADR-0012). */
export const readPreferences = (db: Db, userId?: string): Preferences =>
  preferencesSchema.parse({
    ...DEFAULTS,
    ...entries(db.select().from(settings).all()),
    ...(userId &&
      entries(db.select().from(userSettings).where(eq(userSettings.userId, userId)).all())),
  });

/** The project root folders, as configured (not resolved). */
export const rootPaths = (db: Db) => readPreferences(db).projectRoots.map((r) => r.path);
