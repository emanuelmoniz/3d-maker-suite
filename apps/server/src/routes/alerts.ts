import {
  type Alert,
  type AlertHistoryItem,
  type AlertWithDetail,
  alertActionSchema,
  alertHistoryItemSchema,
  alertHistoryQuery,
  alertSchema,
  alertWithDetailSchema,
  apiErrorSchema,
  channelInputSchema,
  channelSettingsSchema,
  type Page,
  pageOf,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import {
  type AnyColumn,
  and,
  desc,
  eq,
  getTableColumns,
  isNull,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { channels, readChannel, sendVia, writeChannel } from "../alerts/channels.ts";
import { HttpError } from "../errors.ts";
import { listPage } from "../lib/list.ts";

const { alerts, alertStates } = schema;
const params = z.object({ id: z.uuid() });
const channelParams = z.object({ id: z.string() });
const notFound = { 404: apiErrorSchema };

/**
 * The caller's own read, snooze and dismiss (ADR-0012): their `alert_states` row, else the `alerts`
 * columns (the state from before accounts, and the no-users mode, where no row ever matches).
 */
function own(userId = "") {
  const row = sql`FROM ${alertStates} WHERE ${alertStates.alertId} = ${alerts.id} AND ${alertStates.userId} = ${userId}`;
  const pick = (c: AnyColumn, fallback: SQLWrapper) =>
    sql<
      string | null
    >`CASE WHEN EXISTS (SELECT 1 ${row}) THEN (SELECT ${c} ${row}) ELSE ${fallback} END`;
  return {
    readAt: pick(alertStates.readAt, alerts.readAt),
    snoozedUntil: pick(alertStates.snoozedUntil, alerts.snoozedUntil),
    dismissedAt: pick(alertStates.dismissedAt, alerts.dismissedAt),
    updatedAt: pick(alertStates.updatedAt, alerts.updatedAt),
  };
}

/** An alert as the caller sees it: their own state, and resolved (for everyone) counts as read. */
function view(userId?: string) {
  const o = own(userId);
  return {
    ...getTableColumns(alerts),
    ...o,
    readAt: sql<string | null>`COALESCE(${o.readAt}, ${alerts.resolvedAt})`,
    // The caller's last change or a resolve, whichever is later.
    updatedAt: sql<
      string | null
    >`NULLIF(max(COALESCE(${o.updatedAt}, ''), COALESCE(${alerts.updatedAt}, '')), '')`,
  };
}

export const alertsRoutes =
  (db: Db, key: Buffer, evaluate: () => Promise<void>): FastifyPluginAsyncZod =>
  async (app) => {
    const channel = (id: string) => {
      const c = channels.find((x) => x.id === id);
      if (!c) throw new HttpError(404, "not_found", "Channel not found");
      return c;
    };

    const one = (id: string, userId?: string) => {
      const row = db.select(view(userId)).from(alerts).where(eq(alerts.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Alert not found");
      return { ...row, hasDetail: !!row.detail } as AlertWithDetail;
    };

    /** Open alerts, the caller's dismissed ones left out. The app splits active from snoozed. */
    app.get("/", { schema: { response: { 200: z.array(alertSchema) } } }, async (req) => {
      // The detail (a sync log) stays here: the app polls this list every minute.
      const { detail: _, ...columns } = view(req.user?.id);
      return db
        .select({ ...columns, hasDetail: sql<number>`${alerts.detail} IS NOT NULL` })
        .from(alerts)
        .where(and(isNull(alerts.resolvedAt), sql`${columns.dismissedAt} IS NULL`))
        .orderBy(desc(alerts.createdAt))
        .all()
        .map((a) => ({ ...a, hasDetail: !!a.hasDetail })) as Alert[];
    });

    /**
     * Alerts that no longer need attention: resolved, dismissed, snoozed, or a success that was read.
     * The mirror of what the app shows under "needs attention".
     */
    app.get(
      "/history",
      {
        schema: {
          querystring: alertHistoryQuery,
          response: { 200: pageOf(alertHistoryItemSchema) },
        },
      },
      async (req) => {
        const now = new Date().toISOString();
        const { detail: _, ...columns } = view(req.user?.id);
        const snoozed = sql`${columns.snoozedUntil} > ${now}`;
        const status = sql<string>`CASE
          WHEN ${alerts.resolvedAt} IS NOT NULL THEN 'resolved'
          WHEN ${columns.dismissedAt} IS NOT NULL THEN 'dismissed'
          WHEN ${snoozed} THEN 'snoozed'
          ELSE 'read' END`;
        const updatedAt = sql<string>`COALESCE(${columns.updatedAt}, ${alerts.createdAt})`;
        const page = listPage(db, alerts, req.query, {
          sort: {
            updatedAt,
            createdAt: alerts.createdAt,
            module: alerts.module,
            severity: alerts.severity,
            status,
          },
          defaultSort: "-updatedAt",
          select: {
            ...columns,
            updatedAt,
            status,
            hasDetail: sql<number>`${alerts.detail} IS NOT NULL`,
          },
          where: [
            or(
              sql`${alerts.resolvedAt} IS NOT NULL`,
              sql`${columns.dismissedAt} IS NOT NULL`,
              snoozed,
              sql`${alerts.severity} = 'success' AND ${columns.readAt} IS NOT NULL`,
            ),
          ],
          filters: {
            kind: alerts.kind,
            module: alerts.module,
            severity: alerts.severity,
            status,
            createdAt: alerts.createdAt,
            updatedAt,
          },
        }) as unknown as Page<Omit<AlertHistoryItem, "hasDetail"> & { hasDetail: number }>;
        return { ...page, items: page.items.map((a) => ({ ...a, hasDetail: !!a.hasDetail })) };
      },
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: alertWithDetailSchema, ...notFound } } },
      async (req) => one(req.params.id, req.user?.id),
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
        const stamp = now.toISOString();
        const a = req.body;
        const set = {
          read: { readAt: stamp },
          unread: { readAt: null },
          unsnooze: { snoozedUntil: null },
          undismiss: { dismissedAt: null },
          dismiss: { readAt: stamp, dismissedAt: stamp },
          snooze: {
            readAt: stamp,
            snoozedUntil: new Date(
              now.getTime() + (a.action === "snooze" ? a.days : 0) * 86_400_000,
            ).toISOString(),
          },
        }[a.action];
        const { id } = req.params;
        const user = req.user?.id;
        if (!user) {
          // No users: the shared state on the alert itself.
          const row = db
            .update(alerts)
            .set({ ...set, updatedAt: stamp })
            .where(eq(alerts.id, id))
            .returning({ id: alerts.id })
            .get();
          if (!row) throw new HttpError(404, "not_found", "Alert not found");
        } else
          db.transaction((tx) => {
            // Starts from what the caller sees, so a state from before accounts carries over.
            const cur = tx.select(own(user)).from(alerts).where(eq(alerts.id, id)).get();
            if (!cur) throw new HttpError(404, "not_found", "Alert not found");
            const row = { ...cur, ...set, updatedAt: stamp };
            tx.insert(alertStates)
              .values({ alertId: id, userId: user, ...row })
              .onConflictDoUpdate({ target: [alertStates.alertId, alertStates.userId], set: row })
              .run();
          });
        const { detail: _, ...rest } = one(id, user);
        return rest as Alert;
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
