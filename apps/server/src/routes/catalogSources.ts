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
import type { DeviceCatalog } from "../integrations/deviceCatalog.ts";

/** Catalog → Sources (ADR-0020): each slicer library's routes and catalog source. */
export const catalogSourcesRoutes =
  (db: Db, adapters: IntegrationAdapter[], catalog: DeviceCatalog): FastifyPluginAsyncZod =>
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
          response: {
            204: z.null(),
            409: apiErrorSchema,
            422: apiErrorSchema,
            502: apiErrorSchema,
            504: apiErrorSchema,
          },
        },
      },
      async (req, reply) => {
        const pick = req.body;
        // An online device must be able to send (409 `device_outdated`); offline, it learns when it
        // connects.
        await pickCatalogSource(db, adapters, req.params.library, pick, async () => {
          if ("deviceId" in pick) await catalog.confirm(pick.deviceId);
        });
        // The new source starts sending, an old one stops.
        await catalog.tell();
        return reply.status(204).send(null);
      },
    );
  };
