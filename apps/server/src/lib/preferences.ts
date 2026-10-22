import { PREFERENCE_DEFAULTS, type Preferences, preferencesSchema } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";

// ponytail: pnpm names the running script; `pnpm dev` logs by default, `pnpm start` doesn't.
const DEFAULTS = {
  ...PREFERENCE_DEFAULTS,
  logActive: process.env.npm_lifecycle_event === "dev",
};

/** Stored rows over the defaults. */
export const readPreferences = (db: Db): Preferences =>
  preferencesSchema.parse({
    ...DEFAULTS,
    ...Object.fromEntries(
      db
        .select()
        .from(schema.settings)
        .all()
        .map((r) => [r.key, r.value]),
    ),
  });

/** The project root folders, as configured (not resolved). */
export const rootPaths = (db: Db) => readPreferences(db).projectRoots.map((r) => r.path);
