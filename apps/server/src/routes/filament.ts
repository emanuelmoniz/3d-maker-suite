import {
  apiErrorSchema,
  archivedFilter,
  type FilamentProfile,
  filamentProfileInputSchema,
  filamentProfilePatchSchema,
  filamentProfileSchema,
  filamentProfileSortFields,
  idList,
  listQuery,
  type Page,
  pageOf,
  type Spool,
  type SpoolWeightEntry,
  spoolAdjustSchema,
  spoolInputSchema,
  spoolPatchSchema,
  spoolSchema,
  spoolSortFields,
  spoolWeightEntrySchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { inIds, listPage, taggedWith } from "../lib/list.ts";
import { setRemaining } from "../lib/spools.ts";

const { filamentProfiles, spools, spoolWeightEntries } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
const archivedAt = (archived?: boolean) =>
  archived === undefined ? undefined : archived ? new Date().toISOString() : null;

export const filamentRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const getProfile = (id: string) => {
      const row = db.select().from(filamentProfiles).where(eq(filamentProfiles.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Filament profile not found");
      return row;
    };
    const getSpool = (id: string) => {
      const row = db.select().from(spools).where(eq(spools.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Spool not found");
      return row;
    };

    // --- Profiles (the product: brand, material, colour). Archived, never deleted.
    app.get(
      "/profiles",
      {
        schema: {
          querystring: listQuery(filamentProfileSortFields, { archived: archivedFilter }),
          response: { 200: pageOf(filamentProfileSchema) },
        },
      },
      async (req) =>
        listPage(db, filamentProfiles, req.query, {
          sort: {
            brand: filamentProfiles.brand,
            material: filamentProfiles.material,
            createdAt: filamentProfiles.createdAt,
          },
          dateColumn: filamentProfiles.createdAt,
          where: [
            req.query.archived === "true"
              ? isNotNull(filamentProfiles.archivedAt)
              : isNull(filamentProfiles.archivedAt),
          ],
        }) as Page<FilamentProfile>,
    );

    app.post(
      "/profiles",
      { schema: { body: filamentProfileInputSchema, response: { 201: filamentProfileSchema } } },
      async (req, reply) =>
        reply.status(201).send(
          db
            .insert(filamentProfiles)
            .values({ brand: "", name: "", ...req.body })
            .returning()
            .get() as FilamentProfile,
        ),
    );

    app.get(
      "/profiles/:id",
      { schema: { params, response: { 200: filamentProfileSchema, ...notFound } } },
      async (req) => getProfile(req.params.id) as FilamentProfile,
    );

    app.patch(
      "/profiles/:id",
      {
        schema: {
          params,
          body: filamentProfilePatchSchema,
          response: { 200: filamentProfileSchema, ...notFound },
        },
      },
      async (req) => {
        getProfile(req.params.id);
        const { archived, ...fields } = req.body;
        return db
          .update(filamentProfiles)
          .set({ ...fields, archivedAt: archivedAt(archived) })
          .where(eq(filamentProfiles.id, req.params.id))
          .returning()
          .get() as FilamentProfile;
      },
    );

    // --- Spools (physical rolls of a profile)
    app.get(
      "/spools",
      {
        schema: {
          querystring: listQuery(spoolSortFields, {
            archived: archivedFilter,
            profileId: idList.optional(),
            tagId: idList.optional(),
          }),
          response: { 200: pageOf(spoolSchema) },
        },
      },
      async (req) =>
        listPage(db, spools, req.query, {
          sort: {
            createdAt: spools.createdAt,
            remainingGrams: spools.remainingGrams,
            purchasedAt: spools.purchasedAt,
          },
          dateColumn: spools.createdAt,
          where: [
            req.query.archived === "true"
              ? isNotNull(spools.archivedAt)
              : isNull(spools.archivedAt),
            inIds(spools.profileId, req.query.profileId),
            taggedWith(db, "spool", spools.id, req.query.tagId),
          ],
        }) as Page<Spool>,
    );

    app.get(
      "/spools/:id",
      { schema: { params, response: { 200: spoolSchema, ...notFound } } },
      async (req) => getSpool(req.params.id) as Spool,
    );

    app.post(
      "/spools",
      { schema: { body: spoolInputSchema, response: { 201: spoolSchema, ...notFound } } },
      async (req, reply) => {
        if (getProfile(req.body.profileId).archivedAt)
          throw new HttpError(400, "profile_archived", "Filament profile is archived");
        const remainingGrams = req.body.remainingGrams ?? req.body.initialGrams;
        const row = db.transaction((tx) => {
          const spool = tx
            .insert(spools)
            .values({ ...req.body, remainingGrams })
            .returning()
            .get();
          // Opening entry, so the ledger sums to the current weight from day one.
          tx.insert(spoolWeightEntries)
            .values({
              spoolId: spool.id,
              kind: "manual",
              deltaGrams: remainingGrams,
              remainingAfter: remainingGrams,
            })
            .run();
          return spool;
        });
        return reply.status(201).send(row as Spool);
      },
    );

    app.patch(
      "/spools/:id",
      {
        schema: {
          params,
          body: spoolPatchSchema,
          response: { 200: spoolSchema, ...notFound },
        },
      },
      async (req) => {
        getSpool(req.params.id);
        const { archived, ...fields } = req.body;
        return db
          .update(spools)
          .set({ ...fields, archivedAt: archivedAt(archived) })
          .where(eq(spools.id, req.params.id))
          .returning()
          .get() as Spool;
      },
    );

    // --- Weight ledger: the only way to change remaining weight after creation.
    app.post(
      "/spools/:id/adjust",
      {
        schema: {
          params,
          body: spoolAdjustSchema,
          response: { 200: spoolSchema, ...notFound },
        },
      },
      async (req) => {
        const spool = getSpool(req.params.id);
        const { kind, remainingGrams, note } = req.body;
        return (setRemaining(db, spool.id, kind, remainingGrams, note) ?? spool) as Spool;
      },
    );

    app.get(
      "/spools/:id/history",
      { schema: { params, response: { 200: z.array(spoolWeightEntrySchema), ...notFound } } },
      async (req) => {
        getSpool(req.params.id);
        return db
          .select()
          .from(spoolWeightEntries)
          .where(eq(spoolWeightEntries.spoolId, req.params.id))
          .orderBy(desc(sql`rowid`))
          .all() as SpoolWeightEntry[];
      },
    );
  };
