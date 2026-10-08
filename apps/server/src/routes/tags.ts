import {
  apiErrorSchema,
  type Collection,
  type CollectionDetail,
  collectionDetailSchema,
  collectionInputSchema,
  collectionPatchSchema,
  collectionSchema,
  entityParams,
  setCollectionProjectsSchema,
  setTagsSchema,
  type Tag,
  type Tagging,
  taggingSchema,
  taggingsQuery,
  tagInputSchema,
  tagPatchSchema,
  tagSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";

const { tags, taggings, collections, collectionProjects, projects, prints, spools, printers } =
  schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
const tables = { project: projects, print: prints, spool: spools, printer: printers } as const;

const isUnique = (e: unknown) => String((e as Error).message).includes("UNIQUE");

// ponytail: tags are few, so lists are unpaginated. Paginate if anyone has thousands.
export const tagsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(tags).where(eq(tags.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Tag not found");
      return row;
    };
    const duplicate = () => new HttpError(409, "duplicate_tag", "A tag with this name exists");

    app.get(
      "/",
      { schema: { response: { 200: z.array(tagSchema) } } },
      async () => db.select().from(tags).orderBy(asc(tags.name)).all() as Tag[],
    );

    app.post(
      "/",
      { schema: { body: tagInputSchema, response: { 201: tagSchema } } },
      async (req, reply) => {
        try {
          return reply.status(201).send(db.insert(tags).values(req.body).returning().get() as Tag);
        } catch (e) {
          throw isUnique(e) ? duplicate() : e;
        }
      },
    );

    app.patch(
      "/:id",
      { schema: { params, body: tagPatchSchema, response: { 200: tagSchema, ...notFound } } },
      async (req) => {
        get(req.params.id);
        try {
          return db
            .update(tags)
            .set(req.body)
            .where(eq(tags.id, req.params.id))
            .returning()
            .get() as Tag;
        } catch (e) {
          throw isUnique(e) ? duplicate() : e;
        }
      },
    );

    // Taggings go with it (FK cascade).
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        db.delete(tags).where(eq(tags.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
    );

    app.get(
      "/taggings",
      {
        schema: { querystring: taggingsQuery, response: { 200: z.array(taggingSchema) } },
      },
      async (req) =>
        db
          .select()
          .from(taggings)
          .where(eq(taggings.entityType, req.query.entityType))
          .all() as Tagging[],
    );

    app.put(
      "/taggings/:type/:id",
      {
        schema: {
          params: entityParams,
          body: setTagsSchema,
          response: { 200: z.array(taggingSchema), 400: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        const { type, id } = req.params;
        const table = tables[type];
        if (!db.select({ id: table.id }).from(table).where(eq(table.id, id)).get())
          throw new HttpError(404, "not_found", "Tagged item not found");
        const tagIds = [...new Set(req.body.tagIds)];
        if (
          tagIds.length &&
          db.select().from(tags).where(inArray(tags.id, tagIds)).all().length !== tagIds.length
        )
          throw new HttpError(400, "invalid_tag", "Tag not found");
        const where = and(eq(taggings.entityType, type), eq(taggings.entityId, id));
        return db.transaction((tx) => {
          tx.delete(taggings).where(where).run();
          if (tagIds.length)
            tx.insert(taggings)
              .values(tagIds.map((tagId) => ({ tagId, entityType: type, entityId: id })))
              .run();
          return tx.select().from(taggings).where(where).all() as Tagging[];
        });
      },
    );
  };

export const collectionsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(collections).where(eq(collections.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Collection not found");
      return row;
    };
    const detail = (id: string): CollectionDetail => ({
      ...get(id),
      projectIds: db
        .select({ id: collectionProjects.projectId })
        .from(collectionProjects)
        .where(eq(collectionProjects.collectionId, id))
        .orderBy(asc(collectionProjects.position))
        .all()
        .map((r) => r.id),
    });

    app.get(
      "/",
      { schema: { response: { 200: z.array(collectionSchema) } } },
      async () =>
        db.select().from(collections).orderBy(asc(collections.name)).all() as Collection[],
    );

    app.post(
      "/",
      { schema: { body: collectionInputSchema, response: { 201: collectionDetailSchema } } },
      async (req, reply) =>
        reply
          .status(201)
          .send(detail(db.insert(collections).values(req.body).returning().get().id)),
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: collectionDetailSchema, ...notFound } } },
      async (req) => detail(req.params.id),
    );

    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: collectionPatchSchema,
          response: { 200: collectionDetailSchema, ...notFound },
        },
      },
      async (req) => {
        get(req.params.id);
        db.update(collections).set(req.body).where(eq(collections.id, req.params.id)).run();
        return detail(req.params.id);
      },
    );

    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        db.delete(collections).where(eq(collections.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
    );

    // Membership and manual order in one call: the array order is the position.
    app.put(
      "/:id/projects",
      {
        schema: {
          params,
          body: setCollectionProjectsSchema,
          response: { 200: collectionDetailSchema, 400: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        get(req.params.id);
        const ids = [...new Set(req.body.projectIds)];
        if (
          ids.length &&
          db.select().from(projects).where(inArray(projects.id, ids)).all().length !== ids.length
        )
          throw new HttpError(400, "invalid_project", "Project not found");
        db.transaction((tx) => {
          tx.delete(collectionProjects)
            .where(eq(collectionProjects.collectionId, req.params.id))
            .run();
          if (ids.length)
            tx.insert(collectionProjects)
              .values(
                ids.map((projectId, position) => ({
                  collectionId: req.params.id,
                  projectId,
                  position,
                })),
              )
              .run();
        });
        return detail(req.params.id);
      },
    );
  };
