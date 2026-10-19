import { join } from "node:path";
import {
  defaultSlicePrinter,
  type IntegrationAdapter,
  IntegrationError,
  type ProjectModel,
  printerFitsFile,
  projectMetaSchema,
  type SliceRequest,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { capableRows, slicerConfigDir } from "../integrations/capabilities.ts";
import { insideRoots } from "../lib/launcher.ts";
import { readPreferences } from "../lib/preferences.ts";
import { fingerprint } from "./fingerprint.ts";

const { brands, filamentProfiles, machineProfiles, printerModels, printers } = schema;
const { printProfiles, projectSlicePlates, projects } = schema;

/** Stored in `sliceError` as `code` or `code: detail` (the detail is the slicer's own text). */
export const SLICE_ERRORS = [
  "no_slicer",
  "not_allowed",
  "no_preset",
  "no_machine_preset",
  "no_printer_profile",
  "slice_failed",
] as const;

type PlateRow = typeof projectSlicePlates.$inferSelect;
type PlateChoice = Pick<PlateRow, "printerId" | "printProfileId" | "useDefaultPrintProfile">;
type FileInfo = Pick<ProjectModel, "printerModel" | "nozzleDiameter">;

export type SliceJob = { projectId: string; file: string; plate: number };
const same = (a: SliceJob, b: SliceJob) =>
  a.projectId === b.projectId && a.file === b.file && a.plate === b.plate;

/** The slicer integration: the default slicer if it can slice, else the first one that can. */
export function sliceIntegration(db: Db, adapters: IntegrationAdapter[]) {
  const rows = capableRows(db, adapters, "slice");
  const pick = readPreferences(db).defaultSlicerId;
  return rows.find((r) => r.row.id === pick) ?? rows[0];
}

/**
 * How a plate slices: its printer (its own, else `defaultSlicePrinter`), whether that printer is
 * the 3MF's (then the file's own settings fit), and the print profile: its own, else the
 * printer's default when asked for or when the file's process is for another printer.
 */
export function plateResolver(db: Db) {
  const { defaultPrinterId } = readPreferences(db);
  const all = db
    .select({
      id: printers.id,
      name: printers.name,
      modelId: printers.modelId,
      nozzleDiameterMm: printers.nozzleDiameterMm,
      printProfileId: printers.printProfileId,
      archivedAt: printers.archivedAt,
      model: printerModels.model,
      brand: brands.name,
    })
    .from(printers)
    .leftJoin(printerModels, eq(printerModels.id, printers.modelId))
    .leftJoin(brands, eq(brands.id, printerModels.brandId))
    .all()
    .map((p) => ({ ...p, model: p.model ?? "" }));
  const active = all.filter((p) => !p.archivedAt);
  return (row: PlateChoice, file: FileInfo | undefined) => {
    const info = file ?? { printerModel: null, nozzleDiameter: null };
    const printer =
      all.find((p) => p.id === row.printerId) ??
      defaultSlicePrinter(active, defaultPrinterId, info);
    // No printer at all: nothing to compare, so the file's own settings.
    const fits = !printer || printerFitsFile(printer, info);
    const profileId =
      row.printProfileId ??
      (row.useDefaultPrintProfile || !fits ? (printer?.printProfileId ?? null) : null);
    return { printer, fits, profileId };
  };
}

class SliceError extends Error {}
const fail = (code: (typeof SLICE_ERRORS)[number], detail?: string): never => {
  throw new SliceError(detail ? `${code}: ${detail}` : code);
};

/**
 * One slice at a time, first in first out, in this process (ADR-0007). Each plate's result or
 * error goes to its `project_slice_plates` row; the queue itself is only in memory.
 */
export function createSliceQueue(db: Db, adapters: IntegrationAdapter[], log: FastifyBaseLogger) {
  const queue: SliceJob[] = [];
  let running: SliceJob | null = null;
  const stop = new AbortController();

  async function sliceOne(job: SliceJob) {
    const where = and(
      eq(projectSlicePlates.projectId, job.projectId),
      eq(projectSlicePlates.file, job.file),
      eq(projectSlicePlates.plate, job.plate),
    );
    const row = db.select().from(projectSlicePlates).where(where).get();
    if (!row) return; // the setup changed meanwhile
    const project = db.select().from(projects).where(eq(projects.id, job.projectId)).get();
    let error: string | null = null;
    let done: Partial<typeof row> = {};
    try {
      const meta = projectMetaSchema.parse(project?.meta ?? {});
      const listed = meta.models.some((m) => m.file === job.file);
      const abs =
        listed && project?.folderPath
          ? await insideRoots(join(project.folderPath, job.file), readPreferences(db).projectRoots)
          : null;
      if (!abs) return fail("not_allowed");
      const found = sliceIntegration(db, adapters);
      const slicer = found?.adapter.slicer;
      if (!found || !slicer) return fail("no_slicer");
      // Presets are named `<library>:<preset id>`; only this slicer's own can be passed to it.
      const prefix = `${found.adapter.library?.id ?? found.adapter.id}:`;
      const own = (source: string | null | undefined) =>
        source?.startsWith(prefix) ? source.slice(prefix.length) : undefined;

      const model = meta.models.find((m) => m.file === job.file);
      const { printer, fits, profileId } = plateResolver(db)(row, model);
      const req: SliceRequest = { file: abs, plate: job.plate };
      if (profileId) {
        const p = db.select().from(printProfiles).where(eq(printProfiles.id, profileId)).get();
        req.process = own(p?.sourcePreset);
        if (!req.process) fail("no_preset", p?.name);
      }
      if (printer && !fits) {
        // Another printer than the file's: its machine preset, for its model and nozzle.
        if (!req.process) fail("no_printer_profile", printer.name);
        req.machine = db
          .select({ source: machineProfiles.sourcePreset })
          .from(machineProfiles)
          .where(
            and(
              eq(machineProfiles.printerModelId, printer.modelId ?? ""),
              eq(machineProfiles.nozzleDiameterMm, printer.nozzleDiameterMm),
              isNull(machineProfiles.archivedAt),
            ),
          )
          .all()
          .map((m) => own(m.source))
          .find(Boolean);
        if (!req.machine) fail("no_machine_preset", printer.name);
      }
      if (row.filaments.some(Boolean)) {
        const ids = row.filaments.filter((f): f is string => !!f);
        const presets = new Map(
          db
            .select({ id: filamentProfiles.id, source: filamentProfiles.sourcePreset })
            .from(filamentProfiles)
            .where(inArray(filamentProfiles.id, ids))
            .all()
            .map((f) => [f.id, own(f.source)]),
        );
        // ponytail: a hand-made filament keeps the 3MF's own for slicing (grams barely change
        // within a material); its price still counts. Ask for a preset if that turns out wrong.
        req.filaments = row.filaments.map((f) => (f && presets.get(f)) || null);
      }

      const before = await fingerprint(abs);
      if (!before) return fail("not_allowed");
      const result = await slicer.slice(
        found.row.slicerPath ?? "",
        slicerConfigDir(found.row, found.adapter) ?? "",
        req,
        stop.signal,
      );
      done = {
        ...before,
        slicedAt: new Date().toISOString(),
        slicedPrintProfileId: profileId,
        printTimeSeconds: result.printTimeSeconds,
        weightGrams: result.weightGrams,
        slicedFilaments: result.filaments,
      };
    } catch (e) {
      error =
        e instanceof SliceError
          ? e.message
          : e instanceof IntegrationError && e.code === "slice_failed"
            ? e.message
            : "slice_failed";
      if (!(e instanceof SliceError)) log.warn({ err: e, job }, "slice failed");
    }
    // Only if the plate still has the profiles it was sliced with (the setup may have been saved).
    const now = db.select().from(projectSlicePlates).where(where).get();
    if (
      !now ||
      now.printerId !== row.printerId ||
      now.printProfileId !== row.printProfileId ||
      now.useDefaultPrintProfile !== row.useDefaultPrintProfile ||
      JSON.stringify(now.filaments) !== JSON.stringify(row.filaments)
    )
      return;
    db.update(projectSlicePlates)
      .set({ ...done, sliceError: error })
      .where(eq(projectSlicePlates.id, now.id))
      .run();
  }

  async function pump() {
    if (running) return;
    while (!stop.signal.aborted) {
      running = queue.shift() ?? null;
      if (!running) break;
      await sliceOne(running).catch((err) => log.error({ err }, "slice job crashed"));
    }
    running = null;
  }

  return {
    /** Adds the plates not already waiting; returns at once. */
    add(jobs: SliceJob[]) {
      for (const j of jobs)
        if (!(running && same(running, j)) && !queue.some((q) => same(q, j))) queue.push(j);
      void pump();
    },
    state(job: SliceJob): "queued" | "running" | null {
      if (running && same(running, job)) return "running";
      return queue.some((q) => same(q, job)) ? "queued" : null;
    },
    close() {
      queue.length = 0;
      stop.abort();
    },
  };
}

export type SliceQueue = ReturnType<typeof createSliceQueue>;
