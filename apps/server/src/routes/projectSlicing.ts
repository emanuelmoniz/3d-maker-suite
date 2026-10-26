import { join } from "node:path";
import type { IntegrationAdapter } from "@3d-maker-suite/core";
import {
  apiErrorSchema,
  type PlateState,
  type ProjectSlicing,
  projectMetaSchema,
  projectSlicingInputSchema,
  projectSlicingSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { type Fingerprint, fingerprint, stateOf } from "../projects/fingerprint.ts";
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
        folderPath: row.folderPath,
        meta: projectMetaSchema.parse(row.meta),
        slicerIntegrationId: row.slicerIntegrationId,
      };
    };

    async function read(id: string): Promise<ProjectSlicing> {
      const { folderPath, meta, slicerIntegrationId } = project(id);
      const rows = db
        .select()
        .from(projectSlicePlates)
        .where(eq(projectSlicePlates.projectId, id))
        .orderBy(projectSlicePlates.file, projectSlicePlates.plate)
        .all();
      const resolve = plateResolver(db);
      const slicerOf = slicerResolver(db, adapters);
      const fallback = slicerOf()?.row.id;
      // Taken with the rows, before any await: a job that ends meanwhile has already written them.
      const jobs = rows.map((r) =>
        queue.state(projectJobKey({ projectId: id, file: r.file, plate: r.plate })),
      );
      // One stat (and at most one hash) per file, however many plates it has.
      const states = new Map<string, Promise<PlateState>>();
      const fileState = (r: Row) => {
        if (!folderPath || !meta.models.some((m) => m.file === r.file))
          return Promise.resolve<PlateState>("missing");
        if (!states.has(r.file)) states.set(r.file, stateOf(join(folderPath, r.file), r));
        return states.get(r.file) as Promise<PlateState>;
      };
      return {
        canSlice: !!fallback,
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
            const { profileId } = resolve(
              r,
              meta.models.find((m) => m.file === r.file),
            );
            const slicer = slicerOf([r.slicerIntegrationId, slicerIntegrationId])?.row;
            return {
              file: r.file,
              plate: r.plate,
              printerId: r.printerId,
              printProfileId: r.printProfileId,
              useDefaultPrintProfile: r.useDefaultPrintProfile,
              filaments: r.filaments,
              spools: r.spools,
              slicerIntegrationId: r.slicerIntegrationId,
              state,
              result,
              error: r.sliceError,
              needsSlicing:
                state !== "missing" &&
                (!result ||
                  state === "outdated" ||
                  r.slicedPrintProfileId !== profileId ||
                  slicedWithOther(r, slicer, fallback)),
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
        const { folderPath, meta } = project(req.params.id);
        const { plates } = req.body;
        // Only plates of 3MFs the scanner listed; nothing the client invents is read.
        for (const p of plates)
          if (!meta.models.find((m) => m.file === p.file)?.plates.some((x) => x.index === p.plate))
            throw new HttpError(400, "invalid_reference", `Unknown plate ${p.plate} of ${p.file}`);
        const known = (
          table:
            | typeof printProfiles
            | typeof filamentProfiles
            | typeof printers
            | typeof integrations,
          ids: string[],
        ) =>
          new Set(
            ids.length
              ? db
                  .select({ id: table.id })
                  .from(table)
                  .where(inArray(table.id, [...new Set(ids)]))
                  .all()
                  .map((r) => r.id)
              : [],
          );
        const printIds = plates.flatMap((p) => (p.printProfileId ? [p.printProfileId] : []));
        const filamentIds = plates.flatMap((p) => p.filaments.filter((f): f is string => !!f));
        const prints = known(printProfiles, printIds);
        const filaments = known(filamentProfiles, filamentIds);
        if (printIds.some((i) => !prints.has(i)) || filamentIds.some((i) => !filaments.has(i)))
          throw new HttpError(400, "invalid_reference", "Unknown profile");
        const printerIds = plates.flatMap((p) => (p.printerId ? [p.printerId] : []));
        const printerSet = known(printers, printerIds);
        if (printerIds.some((i) => !printerSet.has(i)))
          throw new HttpError(400, "invalid_reference", "Unknown printer");
        // Any integration, even one that can't slice now: a plate saved unchanged keeps its pick.
        const slicerIds = plates.flatMap((p) =>
          p.slicerIntegrationId ? [p.slicerIntegrationId] : [],
        );
        const slicerSet = known(integrations, slicerIds);
        if (slicerIds.some((i) => !slicerSet.has(i)))
          throw new HttpError(400, "invalid_reference", "Unknown slicer");
        const spoolIds = [
          ...new Set(plates.flatMap((p) => p.spools.filter((s): s is string => !!s))),
        ];
        const spoolProfile = new Map(
          spoolIds.length
            ? db
                .select({ id: spools.id, profileId: spools.profileId })
                .from(spools)
                .where(inArray(spools.id, spoolIds))
                .all()
                .map((s) => [s.id, s.profileId])
            : [],
        );
        if (spoolIds.some((i) => !spoolProfile.has(i)))
          throw new HttpError(400, "invalid_reference", "Unknown spool");

        // Stored fully resolved, so the projects list can tell in SQL what a plate slices with:
        // the printer filled in, a printer that isn't the file's on its default profile, and a
        // picked spool's profile in `filaments`.
        const resolve = plateResolver(db);
        const stored = plates.map((p) => {
          const model = meta.models.find((m) => m.file === p.file);
          const { printer, fits } = resolve(p, model);
          const filaments = [...p.filaments];
          p.spools.forEach((s, i) => {
            if (!s) return;
            while (filaments.length <= i) filaments.push(null);
            filaments[i] = spoolProfile.get(s) ?? null;
          });
          return {
            ...p,
            printerId: printer?.id ?? null,
            useDefaultPrintProfile: !p.printProfileId && (p.useDefaultPrintProfile || !fits),
            filaments,
          };
        });

        const fingerprints = new Map<string, Fingerprint>();
        for (const f of new Set(plates.map((p) => p.file))) {
          const fp = folderPath && (await fingerprint(join(folderPath, f)));
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
    app.post(
      "/:id/slicing/run",
      {
        schema: {
          params,
          response: { 202: projectSlicingSchema, 404: apiErrorSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const now = await read(req.params.id);
        if (!now.canSlice) throw new HttpError(409, "no_slicer", "No slicer set up");
        queue.add(
          now.plates
            .filter((p) => p.needsSlicing && !p.job)
            .map((p) =>
              projectSliceJob(db, adapters, app.log, {
                projectId: req.params.id,
                file: p.file,
                plate: p.plate,
              }),
            ),
        );
        return reply.status(202).send(await read(req.params.id));
      },
    );
  };
