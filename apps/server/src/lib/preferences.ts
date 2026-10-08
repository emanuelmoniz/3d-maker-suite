import { PREFERENCE_DEFAULTS, type Preferences, preferencesSchema } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";

/** Stored rows over the defaults. */
export const readPreferences = (db: Db): Preferences =>
  preferencesSchema.parse({
    ...PREFERENCE_DEFAULTS,
    ...Object.fromEntries(
      db
        .select()
        .from(schema.settings)
        .all()
        .map((r) => [r.key, r.value]),
    ),
  });
