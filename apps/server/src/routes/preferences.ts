import {
  PREFERENCE_DEFAULTS,
  type Preferences,
  preferencesPatchSchema,
  preferencesResponseSchema,
  preferencesSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

const { settings } = schema;

export const preferencesRoutes =
  (db: Db, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const read = (): Preferences =>
      preferencesSchema.parse({
        ...PREFERENCE_DEFAULTS,
        ...Object.fromEntries(
          db
            .select()
            .from(settings)
            .all()
            .map((r) => [r.key, r.value]),
        ),
      });

    app.get("/", { schema: { response: { 200: preferencesResponseSchema } } }, async () => ({
      values: read(),
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
        return { values: read(), dataDir };
      },
    );
  };
