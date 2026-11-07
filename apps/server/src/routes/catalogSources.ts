import {
  apiErrorSchema,
  catalogSourcePickSchema,
  type IntegrationAdapter,
  librarySourcesSchema,
} from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { librarySources, pickCatalogSource } from "../integrations/catalogSource.ts";

/** Catalog → Sources (ADR-0020): each slicer library's routes and catalog source. */
export const catalogSourcesRoutes =
  (db: Db, adapters: IntegrationAdapter[]): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/", { schema: { response: { 200: z.array(librarySourcesSchema) } } }, async () =>
      librarySources(db, adapters),
    );
    app.put(
      "/:library",
      {
        schema: {
          params: z.object({ library: z.string().max(100) }),
          body: catalogSourcePickSchema,
          response: { 204: z.null(), 422: apiErrorSchema },
        },
      },
      async (req, reply) => {
        pickCatalogSource(db, adapters, req.params.library, req.body);
        return reply.status(204).send(null);
      },
    );
  };
