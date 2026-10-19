import {
  apiErrorSchema,
  listQuery,
  type Order,
  type OrderDetail,
  orderDetailSchema,
  orderFilters,
  orderInputSchema,
  orderPatchSchema,
  orderSchema,
  orderSortFields,
  type Page,
  pageOf,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { printCosts } from "../lib/cost.ts";
import { listPage } from "../lib/list.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";

const { orders, orderProjects, clients, quotes, projects, prints, printFilamentUsages } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };

/** Each order's project ids, in one query. */
const projectIdsOf = (db: Db, orderIds: string[]) => {
  const rows = orderIds.length
    ? db.select().from(orderProjects).where(inArray(orderProjects.orderId, orderIds)).all()
    : [];
  return (orderId: string) => rows.filter((r) => r.orderId === orderId).map((r) => r.projectId);
};

export const ordersRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string): OrderDetail => {
      const row = db.select().from(orders).where(eq(orders.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Order not found");
      const list = db.select().from(prints).where(eq(prints.orderId, id)).all();
      const usages = list.length
        ? db
            .select()
            .from(printFilamentUsages)
            .where(
              inArray(
                printFilamentUsages.printId,
                list.map((p) => p.id),
              ),
            )
            .all()
        : [];
      const costs = printCosts(
        db,
        list.map((p) => ({ ...p, usages: usages.filter((u) => u.printId === p.id) })),
      );
      return {
        ...row,
        projectIds: projectIdsOf(db, [id])(id),
        printCount: list.length,
        printsCost: [...costs.values()].reduce((n, c) => n + c.total, 0),
      };
    };

    const checkRefs = (b: {
      clientId?: string | null;
      quoteId?: string | null;
      projectIds?: string[];
      status?: string;
    }) => {
      if (b.clientId && !db.select().from(clients).where(eq(clients.id, b.clientId)).get())
        throw new HttpError(400, "invalid_client", "Client not found");
      if (b.quoteId && !db.select().from(quotes).where(eq(quotes.id, b.quoteId)).get())
        throw new HttpError(400, "invalid_quote", "Quote not found");
      if (
        b.projectIds &&
        db
          .select({ id: projects.id })
          .from(projects)
          .where(inArray(projects.id, b.projectIds))
          .all().length !== b.projectIds.length
      )
        throw new HttpError(400, "invalid_project", "Project not found");
      if (b.status !== undefined && !readPreferences(db).orderStatuses.includes(b.status))
        throw new HttpError(400, "invalid_status", `Unknown order status "${b.status}"`);
    };

    /** Replaces the order's projects; refuses to drop one its prints still belong to. */
    const setProjects = (
      tx: Pick<Db, "select" | "insert" | "delete">,
      id: string,
      ids: string[],
    ) => {
      const inUse = tx
        .select({ id: prints.id })
        .from(prints)
        .where(and(eq(prints.orderId, id), notInArray(prints.projectId, ids)))
        .get();
      if (inUse)
        throw new HttpError(
          409,
          "order_project_in_use",
          "The order has prints of a project being removed",
        );
      tx.delete(orderProjects).where(eq(orderProjects.orderId, id)).run();
      tx.insert(orderProjects)
        .values(ids.map((projectId) => ({ orderId: id, projectId })))
        .run();
    };

    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(orderSortFields, {}, orderFilters),
          response: { 200: pageOf(orderSchema) },
        },
      },
      async (req): Promise<Page<Order>> => {
        const page = listPage(db, orders, req.query, {
          sort: {
            number: orders.number,
            client: sql`(SELECT ${clients.name} FROM ${clients} WHERE ${clients.id} = ${orders.clientId})`,
            status: orders.status,
            price: orders.price,
            createdAt: orders.createdAt,
          },
          defaultSort: "-number",
          filters: {
            number: sql`printf('%03d', ${orders.number})`,
            clientId: orders.clientId,
            status: orders.status,
            createdAt: orders.createdAt,
          },
          where: [
            req.query.projectId &&
              inArray(
                orders.id,
                db
                  .select({ id: orderProjects.orderId })
                  .from(orderProjects)
                  .where(inArray(orderProjects.projectId, req.query.projectId)),
              ),
          ],
        });
        const projectIds = projectIdsOf(
          db,
          page.items.map((o) => o.id),
        );
        return { ...page, items: page.items.map((o) => ({ ...o, projectIds: projectIds(o.id) })) };
      },
    );

    app.post(
      "/",
      {
        schema: {
          body: orderInputSchema,
          response: { 201: orderDetailSchema, 400: apiErrorSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const { projectIds, ...fields } = req.body;
        checkRefs(req.body);
        assertNumberFree(db, orders, "order", fields.number);
        const id = db.transaction((tx) => {
          const row = tx
            .insert(orders)
            .values({
              ...fields,
              number: fields.number ?? nextNumber(orders),
              status: fields.status ?? (readPreferences(db).orderStatuses[0] as string),
            })
            .returning()
            .get();
          setProjects(tx, row.id, projectIds);
          return row.id;
        });
        return reply.status(201).send(get(id));
      },
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: orderDetailSchema, ...notFound } } },
      async (req) => get(req.params.id),
    );

    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: orderPatchSchema,
          response: {
            200: orderDetailSchema,
            400: apiErrorSchema,
            409: apiErrorSchema,
            ...notFound,
          },
        },
      },
      async (req) => {
        const { id } = req.params;
        get(id);
        const { projectIds, ...fields } = req.body;
        checkRefs(req.body);
        assertNumberFree(db, orders, "order", fields.number, id);
        db.transaction((tx) => {
          if (Object.keys(fields).length)
            tx.update(orders).set(fields).where(eq(orders.id, id)).run();
          if (projectIds) setProjects(tx, id, projectIds);
        });
        return get(id);
      },
    );

    // Its prints stay, without an order.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        db.delete(orders).where(eq(orders.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
    );
  };
