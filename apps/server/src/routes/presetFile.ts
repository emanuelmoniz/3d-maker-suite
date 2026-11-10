import {
  apiErrorSchema,
  type IntegrationAdapter,
  inUseDetailsSchema,
  presetSettingsSchema,
} from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { presetSettings, presetUse } from "../integrations/presetSettings.ts";
import type { PresetKind } from "../lib/dependents.ts";

const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };

/**
 * A preset's file (ADR-0020), next to its row under the same prefix, so it needs the row's read
 * rights: `/:id/settings` is every setting with its parents filled in, `/:id/use` where it is used.
 */
export const presetFileRoutes =
  (
    db: Db,
    dataDir: string,
    adapters: IntegrationAdapter[],
    kind: PresetKind,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/:id/settings",
      { schema: { params, response: { 200: presetSettingsSchema, ...notFound } } },
      (req) => presetSettings(db, dataDir, adapters, kind, req.params.id),
    );
    app.get(
      "/:id/use",
      { schema: { params, response: { 200: inUseDetailsSchema, ...notFound } } },
      (req) => ({ dependents: presetUse(db, dataDir, adapters, req.user, kind, req.params.id) }),
    );
  };
