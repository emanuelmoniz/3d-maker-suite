import { preferencesPatchSchema, preferencesResponseSchema } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { readPreferences as read } from "../lib/preferences.ts";

const { settings } = schema;

export const preferencesRoutes =
  (db: Db, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/", { schema: { response: { 200: preferencesResponseSchema } } }, async () => ({
      values: read(db),
      dataDir,
    }));

    app.patch(
      "/",
      { schema: { body: preferencesPatchSchema, response: { 200: preferencesResponseSchema } } },
      async (req) => {
        db.transaction((tx) => {
          for (const [key, value] of Object.entries(req.body)) {
            // null (= unset) is stored as no row, since `settings.value` is NOT NULL.
            if (value === null) tx.delete(settings).where(eq(settings.key, key)).run();
            else
              tx.insert(settings)
                .values({ key, value })
                .onConflictDoUpdate({ target: settings.key, set: { value } })
                .run();
          }
        });
        return { values: read(db), dataDir };
      },
    );
  };
