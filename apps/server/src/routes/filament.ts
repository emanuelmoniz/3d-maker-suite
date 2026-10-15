import {
  apiErrorSchema,
  archivedFilter,
  type FilamentProfile,
  filamentProfileFilters,
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
  spoolFilters,
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
import {
  profileBrand,
  profileColumns,
  profileLabel,
  profileMaterial,
  spoolName,
} from "../lib/catalog.ts";
import { inIds, listPage, taggedWith } from "../lib/list.ts";
import { assertNumberFree } from "../lib/numbers.ts";
import { createSpool, round, setRemaining } from "../lib/spools.ts";

const { filamentProfiles, spools, spoolWeightEntries } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
const archivedAt = (archived?: boolean) =>
  archived === undefined ? undefined : archived ? new Date().toISOString() : null;

export const filamentRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const getProfile = (id: string) => {
      const row = db
        .select(profileColumns)
        .from(filamentProfiles)
        .where(eq(filamentProfiles.id, id))
        .get();
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
          querystring: listQuery(
            filamentProfileSortFields,
            { archived: archivedFilter },
            filamentProfileFilters,
          ),
          response: { 200: pageOf(filamentProfileSchema) },
        },
      },
      async (req) =>
        listPage(db, filamentProfiles, req.query, {
          select: profileColumns,
          sort: {
            brand: sql`${profileBrand} COLLATE NOCASE`,
            material: sql`${profileMaterial} COLLATE NOCASE`,
            createdAt: filamentProfiles.createdAt,
            filament: profileLabel,
            pricePerKg: filamentProfiles.pricePerKg,
          },
          dateColumn: filamentProfiles.createdAt,
          filters: {
            filament: profileLabel,
            brandId: filamentProfiles.brandId,
            materialId: filamentProfiles.materialId,
            pricePerKg: filamentProfiles.pricePerKg,
          },
          where: [
            req.query.archived === "true"
              ? isNotNull(filamentProfiles.archivedAt)
              : isNull(filamentProfiles.archivedAt),
          ],
        }) as Page<FilamentProfile>,
    );

    app.post(
      "/profiles",
      {
        schema: {
          body: filamentProfileInputSchema,
          response: { 201: filamentProfileSchema, 400: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const { id } = db
          .insert(filamentProfiles)
          .values({ name: "", ...req.body })
          .returning()
          .get();
        return reply.status(201).send(getProfile(id) as FilamentProfile);
      },
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
        db.update(filamentProfiles)
          .set({ ...fields, archivedAt: archivedAt(archived) })
          .where(eq(filamentProfiles.id, req.params.id))
          .run();
        return getProfile(req.params.id) as FilamentProfile;
      },
    );

    // --- Spools (physical rolls of a profile)
    app.get(
      "/spools",
      {
        schema: {
          querystring: listQuery(
            spoolSortFields,
            { archived: archivedFilter, profileId: idList.optional() },
            spoolFilters,
          ),
          response: { 200: pageOf(spoolSchema) },
        },
      },
      async (req) =>
        listPage(db, spools, req.query, {
          sort: {
            createdAt: spools.createdAt,
            remainingGrams: spools.remainingGrams,
            purchasedAt: spools.purchasedAt,
            // The name starts with the number: sorting by it sorts the name as shown (2 before 10).
            filament: spools.number,
            status: spools.status,
          },
          dateColumn: spools.createdAt,
          filters: {
            filament: spoolName,
            remainingGrams: spools.remainingGrams,
            status: spools.status,
          },
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
      {
        schema: {
          body: spoolInputSchema,
          response: { 201: spoolSchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req, reply) => {
        if (getProfile(req.body.profileId).archivedAt)
          throw new HttpError(400, "profile_archived", "Filament profile is archived");
        assertNumberFree(db, spools, "spool", req.body.number);
        const remainingGrams = req.body.remainingGrams ?? req.body.initialGrams;
        const row = createSpool(db, { ...req.body, remainingGrams });
        return reply.status(201).send(row as Spool);
      },
    );

    app.patch(
      "/spools/:id",
      {
        schema: {
          params,
          body: spoolPatchSchema,
          response: { 200: spoolSchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        const before = getSpool(req.params.id);
        assertNumberFree(db, spools, "spool", req.body.number, req.params.id);
        const { archived, ...fields } = req.body;
        return db.transaction((tx) => {
          const row = tx
            .update(spools)
            .set({ ...fields, archivedAt: archivedAt(archived) })
            .where(eq(spools.id, req.params.id))
            .returning()
            .get();
          // A spool that started with more (or less) has that much more (or less) left now.
          const delta = row.initialGrams - before.initialGrams;
          if (!delta) return row as Spool;
          const moved = setRemaining(
            tx,
            row.id,
            "manual",
            Math.max(0, round(row.remainingGrams + delta)),
            "Initial weight changed",
          );
          return (moved ?? row) as Spool;
        });
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
