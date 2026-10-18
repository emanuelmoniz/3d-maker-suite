import { apiErrorSchema, commentInputSchema, commentPatchSchema } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";

const { printerComments, accessoryComments } = schema;
const params = z.object({ id: z.uuid() });
const commentParams = params.extend({ commentId: z.uuid() });
const notFound = { 404: apiErrorSchema };

/**
 * Notes timeline under `/:id/comments` (pinned first, then newest first), for any entity with a
 * comments table. ponytail: the two tables have the same columns but the parent key; the casts keep
 * one helper typed.
 */
export function commentRoutes(
  app: Parameters<FastifyPluginAsyncZod>[0],
  db: Db,
  o: {
    table: typeof printerComments | typeof accessoryComments;
    parentKey: "printerId" | "accessoryId";
    response: z.ZodType;
    /** Throws 404 when the parent doesn't exist. */
    getParent: (id: string) => unknown;
  },
) {
  const t = o.table as typeof printerComments;
  const parent = t[o.parentKey as "printerId"];
  const getComment = (parentId: string, commentId: string) => {
    o.getParent(parentId);
    const row = db
      .select()
      .from(t)
      .where(and(eq(t.id, commentId), eq(parent, parentId)))
      .get();
    if (!row) throw new HttpError(404, "not_found", "Comment not found");
    return row;
  };

  app.get(
    "/:id/comments",
    { schema: { params, response: { 200: z.array(o.response), ...notFound } } },
    async (req) => {
      o.getParent(req.params.id);
      return db
        .select()
        .from(t)
        .where(eq(parent, req.params.id))
        .orderBy(desc(t.pinned), desc(t.createdAt))
        .all();
    },
  );

  app.post(
    "/:id/comments",
    {
      schema: { params, body: commentInputSchema, response: { 201: o.response, ...notFound } },
    },
    async (req, reply) => {
      o.getParent(req.params.id);
      const row = db
        .insert(t)
        .values({ ...req.body, [o.parentKey]: req.params.id } as typeof t.$inferInsert)
        .returning()
        .get();
      return reply.status(201).send(row);
    },
  );

  app.patch(
    "/:id/comments/:commentId",
    {
      schema: {
        params: commentParams,
        body: commentPatchSchema,
        response: { 200: o.response, ...notFound },
      },
    },
    async (req) => {
      getComment(req.params.id, req.params.commentId);
      return db.update(t).set(req.body).where(eq(t.id, req.params.commentId)).returning().get();
    },
  );

  app.delete(
    "/:id/comments/:commentId",
    { schema: { params: commentParams, response: { 204: z.null(), ...notFound } } },
    async (req, reply) => {
      getComment(req.params.id, req.params.commentId);
      db.delete(t).where(eq(t.id, req.params.commentId)).run();
      return reply.status(204).send(null);
    },
  );
}
