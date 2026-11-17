import {
  apiErrorSchema,
  devicePrinterStatusSchema,
  devicePrintsResultSchema,
  devicePrintsSchema,
  deviceSourceSchema,
  trackedPrintSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { PrinterStatusRunner } from "../integrations/printerStatus.ts";
import type { SourceBridge } from "../integrations/sourceBridge.ts";
import { readPreferences } from "../lib/preferences.ts";
import { deviceOf } from "./hubDevice.ts";

const { integrations } = schema;

/**
 * A connector's side of the printers it reaches for the hub (ADR-0015, LAN reach): the sources
 * assigned to it (with their keys: the one API answer that has them, and only for that device),
 * their live status, and the prints its job tracker saw end. Under `/api/hub/device`.
 */
export const hubDeviceSourcesRoutes =
  (
    db: Db,
    bridge: Pick<SourceBridge, "assigned" | "reaches" | "reachOf">,
    status: Pick<PrinterStatusRunner, "relay" | "recordTracked">,
    log: FastifyBaseLogger,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("onRequest", async () => {
      if (!readPreferences(db).hubEnabled) throw new HttpError(404, "hub_off", "The hub is off");
    });

    app.get(
      "/sources",
      { schema: { response: { 200: z.array(deviceSourceSchema), 403: apiErrorSchema } } },
      async (req, reply) => {
        const deviceId = deviceOf(req);
        // The kinds its Reach switches allow: the connector refuses a test of any other itself.
        reply.header("x-reach", bridge.reachOf(deviceId).join(","));
        return bridge.assigned(deviceId);
      },
    );

    app.post(
      "/sources/status",
      {
        schema: {
          body: devicePrinterStatusSchema,
          response: { 204: z.null(), 403: apiErrorSchema, 404: apiErrorSchema },
        },
      },
      async (req, reply) => {
        if (!status.relay(deviceOf(req), req.body))
          throw new HttpError(404, "not_assigned", "This printer isn't reached through you");
        return reply.status(204).send(null);
      },
    );

    // Done: written, there already, invalid, or no longer this device's (it would wait for good).
    app.post(
      "/sources/prints",
      {
        schema: {
          body: devicePrintsSchema,
          response: { 200: devicePrintsResultSchema, 403: apiErrorSchema },
        },
      },
      async (req) => {
        const deviceId = deviceOf(req);
        const done: string[] = [];
        for (const { key, integrationId, print } of req.body.items) {
          const row = db
            .select({ deviceId: integrations.deviceId, adapterId: integrations.adapterId })
            .from(integrations)
            .where(eq(integrations.id, integrationId))
            .get();
          if (row?.deviceId !== deviceId || !bridge.reaches(row.adapterId, deviceId)) {
            log.warn({ integrationId, deviceId }, "print from a connector the source isn't on");
            done.push(key);
            continue;
          }
          const p = trackedPrintSchema.safeParse(print);
          if (!p.success) {
            log.warn({ integrationId, issues: p.error.issues }, "invalid print from a connector");
            done.push(key);
            continue;
          }
          if (status.recordTracked(integrationId, p.data)) done.push(key);
        }
        return { done };
      },
    );
  };
