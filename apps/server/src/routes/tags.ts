import {
  apiErrorSchema,
  entityParams,
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
import { projectAccessOf, visibleProjects } from "../lib/auth.ts";

const { tags, taggings, projects, prints, spools, printers, accessories } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
const tables = {
  project: projects,
  print: prints,
  spool: spools,
  printer: printers,
  accessory: accessories,
} as const;

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
      async (req) => {
        // Not the tags of projects the caller can't see (ADR-0014).
        const visible = req.query.entityType === "project" && visibleProjects(req.user);
        return db
          .select()
          .from(taggings)
          .where(
            and(
              eq(taggings.entityType, req.query.entityType),
              visible
                ? inArray(
                    taggings.entityId,
                    db.select({ id: projects.id }).from(projects).where(visible),
                  )
                : undefined,
            ),
          )
          .all() as Tagging[];
      },
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
        const access = type === "project" ? projectAccessOf(db, req.user, id) : "edit";
        if (
          access === "none" ||
          !db.select({ id: table.id }).from(table).where(eq(table.id, id)).get()
        )
          throw new HttpError(404, "not_found", "Tagged item not found");
        if (access === "read")
          throw new HttpError(403, "forbidden", "This project is download-only for you");
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
