import type { IntegrationAdapter } from "@3d-maker-suite/core";
import {
  apiErrorSchema,
  type PlateState,
  type ProjectSlicing,
  projectMetaSchema,
  projectSliceRunSchema,
  projectSlicingInputSchema,
  projectSlicingSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { presetLibrary } from "../integrations/capabilities.ts";
import { presetsChanged } from "../integrations/presetLibrary.ts";
import { canReference } from "../lib/archive.ts";
import { type Fingerprint, fingerprint, sameAsScanned, stateOf } from "../projects/fingerprint.ts";
import { onDeviceRoot, projectFile } from "../projects/rootFs.ts";
import {
  plateResolver,
  projectJobKey,
  projectSliceJob,
  type SliceQueue,
  slicedWithOther,
  slicerResolver,
} from "../projects/sliceQueue.ts";

const {
  filamentProfiles,
  integrations,
  machineProfiles,
  printers,
  printProfiles,
  projectSlicePlates,
  projects,
  spools,
} = schema;
const params = z.object({ id: z.uuid() });
type Row = typeof projectSlicePlates.$inferSelect;

/** The result columns a saved-again plate keeps when its file and profiles didn't change. */
const resultOf = (r: Row) => ({
  fileSize: r.fileSize,
  fileMtimeMs: r.fileMtimeMs,
  fileSha256: r.fileSha256,
  slicedAt: r.slicedAt,
  slicedPrintProfileId: r.slicedPrintProfileId,
  slicedIntegrationId: r.slicedIntegrationId,
  slicedSlicerVersion: r.slicedSlicerVersion,
  slicedPresets: r.slicedPresets,
  printTimeSeconds: r.printTimeSeconds,
  weightGrams: r.weightGrams,
  slicedFilaments: r.slicedFilaments,
  sliceError: r.sliceError,
});

/** GET / PUT the plates a project prints (see `projectSlicingSchema`), and slice them. */
export const projectSlicingRoutes =
  (db: Db, adapters: IntegrationAdapter[], queue: SliceQueue): FastifyPluginAsyncZod =>
  async (app) => {
    const project = (id: string) => {
      const row = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Project not found");
      return {
        place: { rootId: row.rootId, folder: row.folder },
        meta: projectMetaSchema.parse(row.meta),
        slicerIntegrationId: row.slicerIntegrationId,
      };
    };

    async function read(id: string): Promise<ProjectSlicing> {
      const { place, meta, slicerIntegrationId } = project(id);
      const rows = db
        .select()
        .from(projectSlicePlates)
        .where(eq(projectSlicePlates.projectId, id))
        .orderBy(projectSlicePlates.file, projectSlicePlates.plate)
        .all();
      const resolve = plateResolver(db);
      const slicerOf = slicerResolver(db, adapters);
      const fallback = slicerOf()?.row.id;
      const here = slicerResolver(db, adapters, true)();
      const presetsStale = presetsChanged(db);
      // Taken with the rows, before any await: a job that ends meanwhile has already written them.
      const jobs = rows.map((r) =>
        queue.state(projectJobKey({ projectId: id, file: r.file, plate: r.plate })),
      );
      // One stat (and at most one hash) per file, however many plates it has.
      const states = new Map<string, Promise<PlateState>>();
      const device = onDeviceRoot(db, place.rootId);
      const fileState = (r: Row) => {
        if (!meta.models.some((m) => m.file === r.file))
          return Promise.resolve<PlateState>("missing");
        if (!states.has(r.file))
          states.set(
            r.file,
            // A device's file is pulled only when its scan says it changed; offline, it is outdated.
            device &&
              sameAsScanned(
                meta.files.find((f) => f.path === r.file),
                r,
              )
              ? Promise.resolve("ok")
              : projectFile(db, place, r.file).then(
                  (abs) => (abs ? stateOf(abs, r) : ("missing" as const)),
                  (e) => {
                    if (device) return "outdated" as const;
                    throw e;
                  },
                ),
          );
        return states.get(r.file) as Promise<PlateState>;
      };
      return {
        canSlice: !!fallback,
        canFallback: !!here,
        plates: await Promise.all(
          rows.map(async (r, i) => {
            const inFile = meta.models
              .find((m) => m.file === r.file)
              ?.plates.some((p) => p.index === r.plate);
            const state = inFile ? await fileState(r) : ("missing" as const);
            const result =
              r.slicedAt && r.printTimeSeconds != null && r.weightGrams != null
                ? {
                    printTimeSeconds: r.printTimeSeconds,
                    weightGrams: r.weightGrams,
                    filaments: r.slicedFilaments ?? [],
                    slicedAt: r.slicedAt,
                  }
                : null;
            const found = slicerOf([r.slicerIntegrationId, slicerIntegrationId]);
            const slicer = found?.row;
            const { profileId } = resolve(
              r,
              meta.models.find((m) => m.file === r.file),
              found && presetLibrary(found.adapter),
            );
            return {
              file: r.file,
              plate: r.plate,
              printerId: r.printerId,
              machineProfileId: r.machineProfileId,
              printProfileId: r.printProfileId,
              useDefaultPrintProfile: r.useDefaultPrintProfile,
              filaments: r.filaments,
              spools: r.spools,
              kept: r.kept,
              slicerIntegrationId: r.slicerIntegrationId,
              state,
              result,
              error: r.sliceError,
              needsSlicing:
                state !== "missing" &&
                (!result ||
                  state === "outdated" ||
                  r.slicedPrintProfileId !== profileId ||
                  slicedWithOther(r, slicer, fallback) ||
                  presetsStale(r)),
              job: jobs[i] ?? null,
            };
          }),
        ),
      };
    }

    app.get(
      "/:id/slicing",
      { schema: { params, response: { 200: projectSlicingSchema, 404: apiErrorSchema } } },
      async (req) => read(req.params.id),
    );

    app.put(
      "/:id/slicing",
      {
        schema: {
          params,
          body: projectSlicingInputSchema,
          response: { 200: projectSlicingSchema, 400: apiErrorSchema, 404: apiErrorSchema },
        },
      },
      async (req) => {
        const { place, meta, slicerIntegrationId } = project(req.params.id);
        const { plates } = req.body;
        // Only plates of 3MFs the scanner listed; nothing the client invents is read.
        for (const p of plates)
          if (!meta.models.find((m) => m.file === p.file)?.plates.some((x) => x.index === p.plate))
            throw new HttpError(400, "invalid_reference", `Unknown plate ${p.plate} of ${p.file}`);
        // What the project's plates already use stays allowed, even if archived since: a plate
        // saved unchanged keeps its pick (ADR-0018). Anything new has to be active.
        const own = db
          .select()
          .from(projectSlicePlates)
          .where(eq(projectSlicePlates.projectId, req.params.id))
          .all();
        const free = (
          table:
            | typeof printProfiles
            | typeof machineProfiles
            | typeof filamentProfiles
            | typeof printers,
          ids: string[],
          was: (string | null)[],
        ) => ids.every((i) => was.includes(i) || canReference(db, table, i));
        const spoolIds = [
          ...new Set(plates.flatMap((p) => p.spools.filter((s): s is string => !!s))),
        ];
        const spoolRows = spoolIds.length
          ? db
              .select({ id: spools.id, archivedAt: spools.archivedAt })
              .from(spools)
              .where(inArray(spools.id, spoolIds))
              .all()
          : [];
        const printIds = plates.flatMap((p) => (p.printProfileId ? [p.printProfileId] : []));
        const filamentIds = plates.flatMap((p) => p.filaments.filter((f): f is string => !!f));
        const machineIds = plates.flatMap((p) => (p.machineProfileId ? [p.machineProfileId] : []));
        if (
          !free(
            printProfiles,
            printIds,
            own.map((p) => p.printProfileId),
          ) ||
          !free(
            machineProfiles,
            machineIds,
            own.map((p) => p.machineProfileId),
          ) ||
          !free(
            filamentProfiles,
            filamentIds,
            own.flatMap((p) => p.filaments),
          )
        )
          throw new HttpError(400, "invalid_reference", "Unknown profile");
        const printerIds = plates.flatMap((p) => (p.printerId ? [p.printerId] : []));
        if (
          !free(
            printers,
            printerIds,
            own.map((p) => p.printerId),
          )
        )
          throw new HttpError(400, "invalid_reference", "Unknown printer");
        // Any integration, even one that can't slice now: a plate saved unchanged keeps its pick.
        const slicerIds = plates.flatMap((p) =>
          p.slicerIntegrationId ? [p.slicerIntegrationId] : [],
        );
        const slicerSet = new Set(
          slicerIds.length
            ? db
                .select({ id: integrations.id })
                .from(integrations)
                .where(inArray(integrations.id, [...new Set(slicerIds)]))
                .all()
                .map((r) => r.id)
            : [],
        );
        if (slicerIds.some((i) => !slicerSet.has(i)))
          throw new HttpError(400, "invalid_reference", "Unknown slicer");
        const ownSpools = own.flatMap((p) => p.spools);
        const spoolOk = (id: string) => {
          const s = spoolRows.find((r) => r.id === id);
          return !!s && (!s.archivedAt || ownSpools.includes(id));
        };
        if (!spoolIds.every(spoolOk))
          throw new HttpError(400, "invalid_reference", "Unknown spool");

        // Stored resolved, so a stored plate says without its file what it slices with: the printer
        // filled in, and a machine that isn't the file's on the default profile. A spool never
        // sets a slot's preset (ADR-0020).
        const resolve = plateResolver(db);
        const slicerOf = slicerResolver(db, adapters);
        const stored = plates.map((p) => {
          const model = meta.models.find((m) => m.file === p.file);
          const found = slicerOf([p.slicerIntegrationId, slicerIntegrationId]);
          const { printer, fromFile } = resolve(p, model, found && presetLibrary(found.adapter));
          return {
            ...p,
            printerId: printer?.id ?? null,
            useDefaultPrintProfile: !p.printProfileId && (p.useDefaultPrintProfile || !fromFile),
          };
        });

        const fingerprints = new Map<string, Fingerprint>();
        for (const f of new Set(plates.map((p) => p.file))) {
          const abs = await projectFile(db, place, f);
          const fp = abs && (await fingerprint(abs));
          if (!fp) throw new HttpError(400, "invalid_reference", `Cannot read ${f}`);
          fingerprints.set(f, fp);
        }
        db.transaction((tx) => {
          const old = tx
            .select()
            .from(projectSlicePlates)
            .where(eq(projectSlicePlates.projectId, req.params.id))
            .all();
          tx.delete(projectSlicePlates)
            .where(eq(projectSlicePlates.projectId, req.params.id))
            .run();
          if (stored.length)
            tx.insert(projectSlicePlates)
              .values(
                stored.map((p) => {
                  const fp = fingerprints.get(p.file) as Fingerprint;
                  // Same file bytes, printer and profiles: the last slice still holds.
                  const was = old.find(
                    (o) =>
                      o.file === p.file &&
                      o.plate === p.plate &&
                      o.fileSha256 === fp.fileSha256 &&
                      o.printerId === p.printerId &&
                      o.machineProfileId === p.machineProfileId &&
                      o.printProfileId === p.printProfileId &&
                      JSON.stringify(o.filaments) === JSON.stringify(p.filaments),
                  );
                  return { ...p, ...fp, ...(was && resultOf(was)), projectId: req.params.id };
                }),
              )
              .run();
        });
        return read(req.params.id);
      },
    );

    // Queues every plate that needs it (never sliced, file or profiles changed) and returns at once.
    // Waiting ones try their worker again, or with `fallback` slice on the server's own slicer.
    app.post(
      "/:id/slicing/run",
      {
        schema: {
          params,
          body: projectSliceRunSchema.nullish(),
          response: { 202: projectSlicingSchema, 404: apiErrorSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const fallback = !!req.body?.fallback;
        if (!fallback) queue.wake();
        const now = await read(req.params.id);
        if (!now.canSlice) throw new HttpError(409, "no_slicer", "No slicer set up");
        if (fallback && !now.canFallback)
          throw new HttpError(409, "no_slicer", "No slicer on the server");
        const plates = now.plates.filter((p) =>
          fallback ? p.job === "waiting" : p.needsSlicing && !p.job,
        );
        for (const p of plates)
          if (fallback) queue.drop(projectJobKey({ ...p, projectId: req.params.id }));
        queue.add(
          plates.map((p) =>
            projectSliceJob(db, adapters, app.log, {
              projectId: req.params.id,
              file: p.file,
              plate: p.plate,
              here: fallback,
            }),
          ),
        );
        return reply.status(202).send(await read(req.params.id));
      },
    );
  };
