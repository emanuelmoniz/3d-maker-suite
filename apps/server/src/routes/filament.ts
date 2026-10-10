import {
  apiErrorSchema,
  archivedFilter,
  type FilamentProfile,
  filamentProfileFilters,
  filamentProfileInputSchema,
  filamentProfilePatchSchema,
  filamentProfileSchema,
  filamentProfileSortFields,
  type IntegrationAdapter,
  idList,
  type LibraryPreview,
  type LibrarySpool,
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
import { capableRow, slicerConfigDir } from "../integrations/capabilities.ts";
import {
  filamentBrandIdFor,
  filamentMaterialIdFor,
  profileBrand,
  profileColumns,
  profileMaterial,
} from "../lib/catalog.ts";
import { inIds, listPage, taggedWith } from "../lib/list.ts";
import { createSpool, setRemaining } from "../lib/spools.ts";

const { filamentProfiles, spools, spoolWeightEntries } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
// The label the app shows for a profile ("brand material name"), to sort and filter by.
const profileLabel = sql`trim(${profileBrand} || ' ' || ${profileMaterial} || ' ' || ${filamentProfiles.name})`;
const spoolLabel = sql`(select ${profileLabel} from ${filamentProfiles} where ${filamentProfiles.id} = ${spools.profileId})`;
const archivedAt = (archived?: boolean) =>
  archived === undefined ? undefined : archived ? new Date().toISOString() : null;

export const filamentRoutes =
  (
    db: Db,
    adapters: IntegrationAdapter[] = [],
    listSpools: (integrationId: string) => Promise<LibrarySpool[]> = async () => [],
  ): FastifyPluginAsyncZod =>
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

    // --- Slicer libraries: an integration's slicer presets, preview, then import the picked ones.
    const readLibrary = async (integrationId: string, includeSystem: boolean) => {
      const { row, adapter } = capableRow(db, adapters, integrationId, "filamentProfiles");
      const dir = slicerConfigDir(row, adapter);
      const lib = adapter.library;
      if (!dir || !lib)
        throw new HttpError(404, "library_not_found", "Slicer config folder not found");
      return { lib, dir, presets: await lib.read(dir, { includeSystem }) };
    };
    const key = (p: { brand: string; material: string; name: string }) =>
      [p.brand, p.material, p.name].map((v) => v.trim().toLowerCase()).join("|");

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
          req.params.id,
          req.query.includeSystem === "true",
        );
        const rows = db.select(profileColumns).from(filamentProfiles).all();
        const imported = new Set(rows.map((r) => r.sourcePreset));
        const have = new Set(rows.map(key));
        return {
          dir,
          items: presets.map((p) => ({
            ...p,
            status: imported.has(`${lib.id}:${p.presetId}`)
              ? "imported"
              : have.has(key(p))
                ? "duplicate"
                : "new",
          })),
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
      async (req) => {
        // Re-read instead of trusting the client, so the preview is only a selection.
        const { lib, presets } = await readLibrary(req.params.id, req.body.includeSystem);
        const picked = new Set(req.body.presetIds);
        const rows = db.select(profileColumns).from(filamentProfiles).all();
        const skip = new Set([...rows.map((r) => r.sourcePreset), ...rows.map(key)]);
        let created = 0;
        db.transaction((tx) => {
          for (const { presetId, scope: _scope, ...p } of presets) {
            const sourcePreset = `${lib.id}:${presetId}`;
            if (!picked.has(presetId) || skip.has(sourcePreset) || skip.has(key(p))) continue;
            const { brand, material, ...fields } = p;
            tx.insert(filamentProfiles)
              .values({
                ...fields,
                brandId: filamentBrandIdFor(db, brand),
                materialId: filamentMaterialIdFor(db, material),
                sourcePreset,
              })
              .run();
            skip.add(sourcePreset).add(key(p)); // two picked presets can be the same filament
            created++;
          }
        });
        return { created };
      },
    );

    // Spools from an integration's inventory (Bambu Cloud's filament manager), read live.
    // Insert-only: re-importing never touches spools you already have, so their ledger stays yours.
    // `spoolId` is already `<adapterId>:<id>` and is stored as `sourceSpool`.
    const importedSpools = () =>
      new Set(
        db
          .select({ s: spools.sourceSpool })
          .from(spools)
          .where(isNotNull(spools.sourceSpool))
          .all()
          .map((r) => r.s),
      );

    app.get(
      "/inventory/:id",
      { schema: { params, response: { 200: librarySpoolPreviewSchema, ...notFound } } },
      async (req): Promise<LibrarySpoolPreview> => {
        const items = await listSpools(req.params.id);
        const imported = importedSpools();
        const active = db
          .select(profileColumns)
          .from(filamentProfiles)
          .where(isNull(filamentProfiles.archivedAt))
          .all();
        // Suggest the active profile with the same brand, material and name, else one named like
        // a slicer preset of it ("PLA Basic" -> "Bambu PLA Basic"). The user can change it.
        // ponytail: suffix match is a naive heuristic; match on the vendor's filament id if it misfires.
        const suggest = ({ profile: s }: LibrarySpool) =>
          (
            active.find((p) => key(p) === key(s)) ??
            active.find(
              (p) =>
                key({ ...p, name: "" }) === key({ ...s, name: "" }) &&
                p.name.toLowerCase().endsWith(` ${s.name.trim().toLowerCase()}`),
            )
          )?.id ?? null;
        return {
          items: items.map((s) => ({
            ...s,
            imported: imported.has(s.spoolId),
            profileId: suggest(s),
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
        const items = await listSpools(req.params.id);
        const imported = importedSpools();
        let created = 0;
        db.transaction((tx) => {
          for (const { spoolId, profile: _profile, ...s } of items) {
            const profileId = picked.get(spoolId);
            if (!profileId || imported.has(spoolId)) continue;
            createSpool(tx, { ...s, profileId, sourceSpool: spoolId });
            imported.add(spoolId);
            created++;
          }
        });
        return { created };
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
