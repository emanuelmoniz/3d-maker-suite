import {
  type Preferences,
  preferencesPatchSchema,
  preferencesResponseSchema,
  USER_PREFERENCE_KEYS,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { HttpError } from "../errors.ts";
import { readPreferences as read } from "../lib/preferences.ts";

const { settings, userSettings } = schema;
const OWN: readonly string[] = USER_PREFERENCE_KEYS;

export const preferencesRoutes =
  (db: Db, dataDir: string, onSaved?: (v: Preferences) => void): FastifyPluginAsyncZod =>
  async (app) => {
    // With users, display keys are each user's own (ADR-0012); without, everything is global.
    app.get("/", { schema: { response: { 200: preferencesResponseSchema } } }, async (req) => ({
      values: read(db, req.user?.id),
      dataDir,
    }));

    app.patch(
      "/",
      { schema: { body: preferencesPatchSchema, response: { 200: preferencesResponseSchema } } },
      async (req) => {
        const user = req.user;
        const role = user?.role;
        // All or nothing: one key the caller may not change rejects the whole patch.
        const denied = Object.keys(req.body).filter(
          (k) => role && role !== "admin" && !OWN.includes(k),
        );
        if (denied.length)
          throw new HttpError(403, "forbidden", `Not allowed for your role: ${denied.join(", ")}`);
        db.transaction((tx) => {
          for (const [key, value] of Object.entries(req.body)) {
            // Display keys aren't nullable, so they never reach the delete below.
            if (user && OWN.includes(key))
              tx.insert(userSettings)
                .values({ userId: user.id, key, value })
                .onConflictDoUpdate({
                  target: [userSettings.userId, userSettings.key],
                  set: { value },
                })
                .run();
            // null (= unset) is stored as no row, since `settings.value` is NOT NULL.
            else if (value === null) tx.delete(settings).where(eq(settings.key, key)).run();
            else
              tx.insert(settings)
                .values({ key, value })
                .onConflictDoUpdate({ target: settings.key, set: { value } })
                .run();
          }
        });
        onSaved?.(read(db));
        return { values: read(db, user?.id), dataDir };
      },
    );
  };
