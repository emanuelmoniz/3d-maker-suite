import { type IntegrationAdapter, librarySourcesSchema } from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { librarySources } from "../integrations/catalogSource.ts";
import type { HubChannel } from "../lib/hubChannel.ts";

/**
 * Catalog → Sources: each slicer library's routes, hub's slicer and receivers. The hub's slicer is
 * picked in Integrations (`PUT /api/integrations/slicers/:library`, ADR-0022).
 */
export const catalogSourcesRoutes =
  (db: Db, adapters: IntegrationAdapter[], hub: HubChannel): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/", { schema: { response: { 200: z.array(librarySourcesSchema) } } }, async () =>
      librarySources(db, adapters, (id) => hub.online(id)),
    );
  };
