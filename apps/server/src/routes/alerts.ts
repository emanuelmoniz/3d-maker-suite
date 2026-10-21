import {
  type Alert,
  type AlertWithDetail,
  alertActionSchema,
  alertSchema,
  alertWithDetailSchema,
  apiErrorSchema,
  channelInputSchema,
  channelSettingsSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { channels, readChannel, sendVia, writeChannel } from "../alerts/channels.ts";
import { HttpError } from "../errors.ts";

const { alerts } = schema;
const params = z.object({ id: z.uuid() });
const channelParams = z.object({ id: z.string() });
const notFound = { 404: apiErrorSchema };

export const alertsRoutes =
  (db: Db, key: Buffer, evaluate: () => Promise<void>): FastifyPluginAsyncZod =>
  async (app) => {
    const channel = (id: string) => {
      const c = channels.find((x) => x.id === id);
      if (!c) throw new HttpError(404, "not_found", "Channel not found");
      return c;
    };

    /** Open alerts, dismissed ones left out. The app splits active from snoozed. */
    app.get("/", { schema: { response: { 200: z.array(alertSchema) } } }, async () => {
      // The detail (a sync log) stays here: the app polls this list every minute.
      const { detail: _, ...columns } = getTableColumns(alerts);
      return db
        .select({ ...columns, hasDetail: sql<number>`${alerts.detail} IS NOT NULL` })
        .from(alerts)
        .where(and(isNull(alerts.resolvedAt), isNull(alerts.dismissedAt)))
        .orderBy(desc(alerts.createdAt))
        .all()
        .map((a) => ({ ...a, hasDetail: !!a.hasDetail })) as Alert[];
    });

    app.get(
      "/:id",
      { schema: { params, response: { 200: alertWithDetailSchema, ...notFound } } },
      async (req) => {
        const row = db.select().from(alerts).where(eq(alerts.id, req.params.id)).get();
        if (!row) throw new HttpError(404, "not_found", "Alert not found");
        return { ...row, hasDetail: !!row.detail } as AlertWithDetail;
      },
    );

    app.post("/evaluate", { schema: { response: { 204: z.null() } } }, async (_req, reply) => {
      await evaluate();
      return reply.status(204).send(null);
    });

    app.patch(
      "/:id",
      { schema: { params, body: alertActionSchema, response: { 200: alertSchema, ...notFound } } },
      async (req) => {
        const now = new Date();
        const a = req.body;
        const set =
          a.action === "read"
            ? { readAt: now.toISOString() }
            : a.action === "dismiss"
              ? { readAt: now.toISOString(), dismissedAt: now.toISOString() }
              : {
                  readAt: now.toISOString(),
                  snoozedUntil: new Date(now.getTime() + a.days * 86_400_000).toISOString(),
                };
        const row = db
          .update(alerts)
          .set(set)
          .where(eq(alerts.id, req.params.id))
          .returning()
          .get();
        if (!row) throw new HttpError(404, "not_found", "Alert not found");
        const { detail, ...rest } = row;
        return { ...rest, hasDetail: !!detail } as Alert;
      },
    );

    // --- Channels. Secret values go in and never come out.
    app.get(
      "/channels",
      { schema: { response: { 200: z.array(channelSettingsSchema) } } },
      async () =>
        channels.map((c) => {
          const { enabled, config, secrets } = readChannel(db, key, c.id);
          return { id: c.id, enabled, config, secretsSet: Object.keys(secrets) };
        }),
    );

    app.put(
      "/channels/:id",
      {
        schema: {
          params: channelParams,
          body: channelInputSchema,
          response: { 200: channelSettingsSchema, ...notFound },
        },
      },
      async (req) => {
        const c = channel(req.params.id);
        // Fields must be valid when the channel is on; a switched-off channel may be half-filled.
        if (req.body.enabled && !c.configSchema.safeParse(req.body.config).success)
          throw new HttpError(400, "invalid_config", "Channel settings are incomplete");
        writeChannel(db, key, c.id, req.body);
        const { enabled, config, secrets } = readChannel(db, key, c.id);
        return { id: c.id, enabled, config, secretsSet: Object.keys(secrets) };
      },
    );

    app.post(
      "/channels/:id/test",
      {
        schema: {
          params: channelParams,
          response: { 200: z.object({ ok: z.boolean() }), ...notFound },
        },
      },
      async (req) => {
        const c = channel(req.params.id);
        try {
          await sendVia(db, key, c.id, { title: "3D Maker Suite", body: "Test notification" });
          return { ok: true };
        } catch (e) {
          req.log.warn({ err: e, channel: c.id }, "test notification failed");
          return { ok: false };
        }
      },
    );
  };
