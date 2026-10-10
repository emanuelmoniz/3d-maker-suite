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
  type LibraryPreview,
  type LibrarySpoolPreview,
  libraryImportResultSchema,
  libraryImportSchema,
  libraryPreviewSchema,
  libraryQuerySchema,
  librarySpoolImportSchema,
  librarySpoolPreviewSchema,
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
  importedSpools,
  presetStatus,
  profileIndex,
  readLibrary,
  spoolProfiles,
} from "../integrations/imports.ts";
import type { Syncer } from "../integrations/sync.ts";
import { profileBrand, profileColumns, profileMaterial } from "../lib/catalog.ts";
import { inIds, listPage, taggedWith } from "../lib/list.ts";
import { createSpool, setRemaining } from "../lib/spools.ts";

const { filamentProfiles, spools, spoolWeightEntries } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
// The label the app shows for a profile (its name, else "brand material"), to sort and filter by.
const profileLabel = sql`coalesce(nullif(${filamentProfiles.name}, ''), trim(${profileBrand} || ' ' || ${profileMaterial}))`;
const spoolLabel = sql`(select ${profileLabel} from ${filamentProfiles} where ${filamentProfiles.id} = ${spools.profileId})`;
const archivedAt = (archived?: boolean) =>
  archived === undefined ? undefined : archived ? new Date().toISOString() : null;

export const filamentRoutes =
  (db: Db, syncer: Syncer): FastifyPluginAsyncZod =>
  async (app) => {
    /** A confirmed preview is a manual run of that type: logged, and its vendor failure a 502. */
    const imported = (run: Awaited<ReturnType<Syncer["run"]>>) => {
      if (run.errorCode) throw new HttpError(502, run.errorCode, "Couldn't import");
      return { created: run.created };
    };
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

    // --- Slicer libraries: an integration's slicer presets, preview, then import the picked ones.

    app.get(
      "/library/:id/preview",
      {
        schema: {
          params,
          querystring: libraryQuerySchema,
          response: { 200: libraryPreviewSchema, ...notFound },
        },
      },
      async (req): Promise<LibraryPreview> => {
        const { lib, dir, presets } = await readLibrary(
          db,
          syncer.adapters,
          req.params.id,
          req.query.includeSystem === "true",
        );
        const idx = profileIndex(db);
        return {
          dir,
          items: presets.map((p) => ({ ...p, status: presetStatus(idx, lib.id, p) })),
        };
      },
    );

    app.post(
      "/library/:id/import",
      {
        schema: {
          params,
          body: libraryImportSchema,
          response: { 200: libraryImportResultSchema, ...notFound },
        },
      },
      // The presets are re-read instead of trusting the client, so the preview is only a selection.
      async (req) =>
        imported(
          await syncer.run(
            req.params.id,
            "manual",
            { type: "filamentProfiles" },
            {
              presets: {
                ids: new Set(req.body.presetIds),
                includeSystem: req.body.includeSystem,
              },
            },
          ),
        ),
    );

    // Spools from an integration's inventory (Bambu Cloud's filament manager), read live.
    // `spoolId` is already `<adapterId>:<id>`.

    app.get(
      "/inventory/:id",
      { schema: { params, response: { 200: librarySpoolPreviewSchema, ...notFound } } },
      async (req): Promise<LibrarySpoolPreview> => {
        const items = await syncer.listSpools(req.params.id);
        const have = importedSpools(db);
        // Suggest the first profile the spool could go on. The user can change it.
        const profilesFor = spoolProfiles(db);
        return {
          items: items.map((s) => ({
            ...s,
            imported: have.has(s.spoolId),
            profileId: profilesFor(s)[0]?.id ?? null,
          })),
        };
      },
    );

    app.post(
      "/inventory/:id/import",
      {
        schema: {
          params,
          body: librarySpoolImportSchema,
          response: { 200: libraryImportResultSchema, ...notFound },
        },
      },
      async (req) => {
        // spoolId -> the profile the user picked for it. Import never creates profiles.
        const picked = new Map(req.body.spools.map((p) => [p.spoolId, p.profileId]));
        for (const profileId of new Set(picked.values()))
          if (getProfile(profileId).archivedAt)
            throw new HttpError(400, "profile_archived", "Filament profile is archived");
        return imported(
          await syncer.run(req.params.id, "manual", { type: "spools" }, { spools: picked }),
        );
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
            filament: spoolLabel,
            status: spools.status,
          },
          dateColumn: spools.createdAt,
          filters: {
            filament: spoolLabel,
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
      { schema: { body: spoolInputSchema, response: { 201: spoolSchema, ...notFound } } },
      async (req, reply) => {
        if (getProfile(req.body.profileId).archivedAt)
          throw new HttpError(400, "profile_archived", "Filament profile is archived");
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
