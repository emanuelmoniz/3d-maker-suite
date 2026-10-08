import { existsSync } from "node:fs";
import {
  apiErrorSchema,
  archivedFilter,
  type FilamentLibrary,
  type FilamentProfile,
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
  librarySourceSchema,
  librarySpoolImportSchema,
  librarySpoolPreviewSchema,
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
import { readPreferences } from "../lib/preferences.ts";
import { createSpool, setRemaining } from "../lib/spools.ts";

const { filamentProfiles, spools, spoolWeightEntries } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
const archivedAt = (archived?: boolean) =>
  archived === undefined ? undefined : archived ? new Date().toISOString() : null;

export const filamentRoutes =
  (db: Db, libraries: FilamentLibrary[] = []): FastifyPluginAsyncZod =>
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

    // --- Slicer libraries: read a slicer's local presets, preview, then import the picked ones.
    const getLibrary = (id: string) => {
      const lib = libraries.find((l) => l.id === id);
      if (!lib) throw new HttpError(404, "not_found", "Unknown filament library");
      return lib;
    };
    const detect = (lib: FilamentLibrary) => lib.defaultDirs().find((d) => existsSync(d)) ?? null;
    const libraryDir = (lib: FilamentLibrary) => {
      const dir = readPreferences(db).libraryPaths[lib.id]?.trim() || detect(lib);
      if (!dir || !existsSync(dir))
        throw new HttpError(404, "library_not_found", "Slicer config folder not found");
      return dir;
    };
    const readLibrary = async (lib: FilamentLibrary, includeSystem: boolean) => {
      const dir = libraryDir(lib);
      return { dir, presets: await lib.read(dir, { includeSystem }) };
    };
    const readSpools = async (lib: FilamentLibrary) => {
      if (!lib.readSpools) throw new HttpError(404, "not_found", "Library has no spools");
      const dir = libraryDir(lib);
      return { dir, items: await lib.readSpools(dir) };
    };
    const key = (p: { brand: string; material: string; name: string; colorHex: string }) =>
      [p.brand, p.material, p.name, p.colorHex].join("|").toLowerCase();

    app.get("/library", { schema: { response: { 200: z.array(librarySourceSchema) } } }, async () =>
      libraries.map((l) => ({ id: l.id, detectedDir: detect(l), spools: !!l.readSpools })),
    );

    app.get(
      "/library/:id/preview",
      {
        schema: {
          params: z.object({ id: z.string() }),
          querystring: libraryQuerySchema,
          response: { 200: libraryPreviewSchema, ...notFound },
        },
      },
      async (req): Promise<LibraryPreview> => {
        const lib = getLibrary(req.params.id);
        const { dir, presets } = await readLibrary(lib, req.query.includeSystem === "true");
        const rows = db.select().from(filamentProfiles).all();
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
          params: z.object({ id: z.string() }),
          body: libraryImportSchema,
          response: { 200: libraryImportResultSchema, ...notFound },
        },
      },
      async (req) => {
        const lib = getLibrary(req.params.id);
        // Re-read instead of trusting the client, so the preview is only a selection.
        const { presets } = await readLibrary(lib, req.body.includeSystem);
        const picked = new Set(req.body.presetIds);
        const rows = db.select().from(filamentProfiles).all();
        const skip = new Set([...rows.map((r) => r.sourcePreset), ...rows.map(key)]);
        let created = 0;
        db.transaction((tx) => {
          for (const { presetId, scope: _scope, ...p } of presets) {
            const sourcePreset = `${lib.id}:${presetId}`;
            if (!picked.has(presetId) || skip.has(sourcePreset) || skip.has(key(p))) continue;
            tx.insert(filamentProfiles)
              .values({ ...p, sourcePreset })
              .run();
            skip.add(sourcePreset).add(key(p)); // two picked presets can be the same filament
            created++;
          }
        });
        return { created };
      },
    );

    // Spools from the slicer's filament inventory. Insert-only: re-importing never touches
    // spools you already have, so their ledger stays yours.
    const sourceSpool = (lib: FilamentLibrary, spoolId: string) => `${lib.id}:${spoolId}`;
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
      "/library/:id/spools",
      {
        schema: {
          params: z.object({ id: z.string() }),
          response: { 200: librarySpoolPreviewSchema, ...notFound },
        },
      },
      async (req): Promise<LibrarySpoolPreview> => {
        const lib = getLibrary(req.params.id);
        const { dir, items } = await readSpools(lib);
        const imported = importedSpools();
        return {
          dir,
          items: items.map((s) => ({ ...s, imported: imported.has(sourceSpool(lib, s.spoolId)) })),
        };
      },
    );

    app.post(
      "/library/:id/spools/import",
      {
        schema: {
          params: z.object({ id: z.string() }),
          body: librarySpoolImportSchema,
          response: { 200: libraryImportResultSchema, ...notFound },
        },
      },
      async (req) => {
        const lib = getLibrary(req.params.id);
        const { items } = await readSpools(lib);
        const picked = new Set(req.body.spoolIds);
        const imported = importedSpools();
        // Spools land on the profile with the same brand, material, name and colour.
        const profiles = new Map(
          db
            .select()
            .from(filamentProfiles)
            .where(isNull(filamentProfiles.archivedAt))
            .all()
            .map((p) => [key(p), p.id]),
        );
        let created = 0;
        db.transaction((tx) => {
          for (const { spoolId, profile, ...s } of items) {
            const source = sourceSpool(lib, spoolId);
            if (!picked.has(spoolId) || imported.has(source)) continue;
            let profileId = profiles.get(key(profile));
            if (!profileId) {
              profileId = tx.insert(filamentProfiles).values(profile).returning().get().id;
              profiles.set(key(profile), profileId);
            }
            createSpool(tx, { ...s, profileId, sourceSpool: source });
            imported.add(source);
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
