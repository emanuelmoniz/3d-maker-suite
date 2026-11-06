import {
  apiErrorSchema,
  archivedFilter,
  type FilamentProfile,
  filamentProfileFilters,
  filamentProfileSchema,
  filamentProfileSortFields,
  listQuery,
  type Page,
  pageOf,
  profilePatchSchema,
  type Spool,
  type SpoolInput,
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
import { desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import {
  alertTasks,
  archivedAtOf,
  archivedWhere,
  assertPresetFree,
  canReference,
  resolveItemAlerts,
} from "../lib/archive.ts";
import {
  presetSource,
  profileBrand,
  profileColumns,
  profileLabel,
  profileMaterial,
  spoolColumns,
  spoolName,
} from "../lib/catalog.ts";
import { deleteItem, presetUsed } from "../lib/dependents.ts";
import { listPage, taggedWith } from "../lib/list.ts";
import { assertNumberFree } from "../lib/numbers.ts";
import { createSpool, round, setRemaining } from "../lib/spools.ts";

const { filamentBrands, filamentMaterials, filamentProfiles, spools, spoolWeightEntries } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };

export const filamentRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const profileExtra = {
      source: presetSource(filamentProfiles.sourcePreset),
      use: presetUsed("filamentProfiles"),
    };
    const profileSelect = { ...profileColumns, ...profileExtra };
    const getProfile = (id: string) => {
      const row = db
        .select(profileSelect)
        .from(filamentProfiles)
        .where(eq(filamentProfiles.id, id))
        .get();
      if (!row) throw new HttpError(404, "not_found", "Filament profile not found");
      return row;
    };
    const getSpool = (id: string) => {
      const row = db.select(spoolColumns).from(spools).where(eq(spools.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Spool not found");
      return row as Spool;
    };
    // A brand or material you archived stays on the spools that have it, but no new one gets it.
    const checkFilament = (b: Partial<SpoolInput>, cur?: Spool) => {
      if (b.brandId && !canReference(db, filamentBrands, b.brandId, cur?.brandId))
        throw new HttpError(400, "invalid_reference", "Filament brand not found");
      if (b.materialId && !canReference(db, filamentMaterials, b.materialId, cur?.materialId))
        throw new HttpError(400, "invalid_reference", "Filament material not found");
    };

    // --- Profiles: slicer files (ADR-0020), listed, archived and deleted, never made here.
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
          select: profileSelect,
          sort: {
            brand: sql`${profileBrand} COLLATE NOCASE`,
            material: sql`${profileMaterial} COLLATE NOCASE`,
            ...profileExtra,
            createdAt: filamentProfiles.createdAt,
            filament: profileLabel,
          },
          dateColumn: filamentProfiles.createdAt,
          filters: {
            filament: profileLabel,
            brandId: filamentProfiles.brandId,
            materialId: filamentProfiles.materialId,
            ...profileExtra,
          },
          where: [archivedWhere(filamentProfiles.archivedAt, req.query.archived)],
        }) as Page<FilamentProfile>,
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
          body: profilePatchSchema,
          response: { 200: filamentProfileSchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        const cur = getProfile(req.params.id);
        const { archived } = req.body;
        if (!archived) assertPresetFree(db, filamentProfiles, cur);
        db.update(filamentProfiles)
          .set({ archivedAt: archivedAtOf(archived) })
          .where(eq(filamentProfiles.id, req.params.id))
          .run();
        return getProfile(req.params.id) as FilamentProfile;
      },
    );

    app.delete(
      "/profiles/:id",
      { schema: { params, response: { 204: z.null(), 409: apiErrorSchema, ...notFound } } },
      async (req, reply) => {
        getProfile(req.params.id);
        deleteItem(db, "filamentProfiles", req.params.id, { user: req.user });
        return reply.status(204).send(null);
      },
    );

    // --- Spools (physical rolls: brand, material, name, colour)
    app.get(
      "/spools",
      {
        schema: {
          querystring: listQuery(spoolSortFields, { archived: archivedFilter }, spoolFilters),
          response: { 200: pageOf(spoolSchema) },
        },
      },
      async (req) =>
        listPage(db, spools, req.query, {
          select: spoolColumns,
          sort: {
            createdAt: spools.createdAt,
            remainingGrams: spools.remainingGrams,
            purchasedAt: spools.purchasedAt,
            // The name starts with the number: sorting by it sorts the name as shown (2 before 10).
            filament: spools.number,
            status: spools.status,
          },
          defaultSort: "remainingGrams",
          dateColumn: spools.createdAt,
          filters: {
            filament: spoolName,
            remainingGrams: spools.remainingGrams,
            status: spools.status,
          },
          where: [
            archivedWhere(spools.archivedAt, req.query.archived),
            taggedWith(db, "spool", spools.id, req.query.tagId),
          ],
        }) as Page<Spool>,
    );

    app.get(
      "/spools/:id",
      { schema: { params, response: { 200: spoolSchema, ...notFound } } },
      async (req) => getSpool(req.params.id),
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
        checkFilament(req.body);
        assertNumberFree(db, spools, "spool", req.body.number);
        // No weight at all = not known yet.
        const initialGrams = req.body.initialGrams ?? null;
        const remainingGrams = req.body.remainingGrams ?? initialGrams;
        const row = createSpool(db, { ...req.body, initialGrams, remainingGrams });
        return reply.status(201).send(getSpool(row.id));
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
        checkFilament(req.body, before);
        assertNumberFree(db, spools, "spool", req.body.number, req.params.id);
        const { archived, ...fields } = req.body;
        // A weight the ledger tracks can change, not go back to unknown.
        if (fields.initialGrams === null && before.initialGrams != null)
          throw new HttpError(400, "weight_required", "A spool's weight can't be unset");
        db.transaction((tx) => {
          const row = tx
            .update(spools)
            .set({ ...fields, archivedAt: archivedAtOf(archived) })
            .where(eq(spools.id, req.params.id))
            .returning()
            .get();
          if (archived) resolveItemAlerts(tx, alertTasks.spool(row.id));
          // The weight is known now: the spool holds all of it until told otherwise.
          if (row.remainingGrams == null && row.initialGrams != null)
            return setRemaining(tx, row.id, "manual", row.initialGrams);
          if (row.initialGrams == null || before.initialGrams == null || row.remainingGrams == null)
            return;
          // A spool that started with more (or less) has that much more (or less) left now.
          const delta = row.initialGrams - before.initialGrams;
          if (delta)
            setRemaining(
              tx,
              row.id,
              "manual",
              Math.max(0, round(row.remainingGrams + delta)),
              "Initial weight changed",
            );
        });
        return getSpool(req.params.id);
      },
    );

    app.delete(
      "/spools/:id",
      { schema: { params, response: { 204: z.null(), 409: apiErrorSchema, ...notFound } } },
      async (req, reply) => {
        getSpool(req.params.id);
        deleteItem(db, "spools", req.params.id, { user: req.user });
        return reply.status(204).send(null);
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
        setRemaining(db, spool.id, kind, remainingGrams, note);
        return getSpool(spool.id);
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
