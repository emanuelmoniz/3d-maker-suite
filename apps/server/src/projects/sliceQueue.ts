import { join } from "node:path";
import {
  defaultSlicePrinter,
  type IntegrationAdapter,
  IntegrationError,
  type ProjectModel,
  pickSlicer,
  printerFitsFile,
  projectMetaSchema,
  type SliceRequest,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { capableRows, slicerConfigDir } from "../integrations/capabilities.ts";
import { insideRoots } from "../lib/launcher.ts";
import { success } from "../lib/logSink.ts";
import { readPreferences, rootPaths } from "../lib/preferences.ts";
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

/** Anything the queue runs; `key` tells whether the same work is already waiting. */
export type SliceJob = { key: string; run: (signal: AbortSignal) => Promise<void> };
export type ProjectPlate = { projectId: string; file: string; plate: number };
export const projectJobKey = (j: ProjectPlate) => `project:${j.projectId}#${j.file}#${j.plate}`;

/**
 * Resolves the slicer integration of `picks` (a plate's, its project's) with the slicers that can
 * slice now: the first that can, else the default slicer, else the first one (`pickSlicer`).
 */
export function slicerResolver(db: Db, adapters: IntegrationAdapter[]) {
  const rows = capableRows(db, adapters, "slice");
  const ids = rows.map((r) => r.row.id);
  const { defaultSlicerId } = readPreferences(db);
  return (picks: (string | null | undefined)[] = []) => {
    const id = pickSlicer(ids, [...picks, defaultSlicerId]);
    return rows.find((r) => r.row.id === id);
  };
}

/**
 * Sliced with another slicer than `now` resolves to. Null (sliced before 0072 stored it) was the
 * default slicer, `fallback` (what no picks resolve to). ponytail: so a later change of the default
 * itself leaves those slices current; they re-slice once anything else changes.
 */
export const slicedWithOther = (
  sliced: string | null,
  now: string | undefined,
  fallback: string | undefined,
) => (sliced ?? fallback) !== now;

export const sliceIntegration = (
  db: Db,
  adapters: IntegrationAdapter[],
  picks?: (string | null | undefined)[],
) => slicerResolver(db, adapters)(picks);

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
 * A plate to slice: the 3MF (absolute, already checked), its info, the profile choices, and the
 * slicer picks (the plate's, its project's; see `sliceIntegration`).
 */
export type PlateToSlice = PlateChoice & {
  abs: string;
  plate: number;
  model: FileInfo | undefined;
  filaments: (string | null)[];
  slicers: (string | null | undefined)[];
};

/**
 * Slices one plate with the slicer integration: the plate's printer, print profile and filament
 * per slot, as presets of that slicer. Throws `SliceError` (code, see `SLICE_ERRORS`) or the
 * slicer's own error; `sliceErrorText` turns either into the stored text.
 */
export async function slicePlate(
  db: Db,
  adapters: IntegrationAdapter[],
  p: PlateToSlice,
  signal: AbortSignal,
) {
  const found = sliceIntegration(db, adapters, p.slicers);
  const slicer = found?.adapter.slicer;
  if (!found || !slicer) return fail("no_slicer");
  // Presets are named `<library>:<preset id>`; only this slicer's own can be passed to it.
  const prefix = `${found.adapter.library?.id ?? found.adapter.id}:`;
  const own = (source: string | null | undefined) =>
    source?.startsWith(prefix) ? source.slice(prefix.length) : undefined;

  const { printer, fits, profileId } = plateResolver(db)(p, p.model);
  const req: SliceRequest = { file: p.abs, plate: p.plate };
  if (profileId) {
    const row = db.select().from(printProfiles).where(eq(printProfiles.id, profileId)).get();
    req.process = own(row?.sourcePreset);
    if (!req.process) fail("no_preset", row?.name);
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
  if (p.filaments.some(Boolean)) {
    const ids = p.filaments.filter((f): f is string => !!f);
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
    req.filaments = p.filaments.map((f) => (f && presets.get(f)) || null);
  }

  const before = await fingerprint(p.abs);
  if (!before) return fail("not_allowed");
  const result = await slicer.slice(
    found.row.slicerPath ?? "",
    slicerConfigDir(found.row, found.adapter) ?? "",
    req,
    signal,
  );
  return { fingerprint: before, profileId, integrationId: found.row.id, result };
}

/** The error text stored for a failed slice; unexpected errors are logged. */
export function sliceErrorText(e: unknown, log: FastifyBaseLogger, context: object): string {
  if (e instanceof SliceError) return e.message;
  if (e instanceof IntegrationError && e.code === "slice_failed") return e.message;
  log.warn({ err: e, ...context }, "slice failed");
  return "slice_failed";
}

/**
 * Slices a plate of a project's setup; its result or error goes to its `project_slice_plates` row.
 * `onError` hears a stored error (auto slices raise an alert with it).
 */
export function projectSliceJob(
  db: Db,
  adapters: IntegrationAdapter[],
  log: FastifyBaseLogger,
  job: ProjectPlate,
  onError?: (error: string) => void,
): SliceJob {
  return {
    key: projectJobKey(job),
    async run(signal) {
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
        const model = meta.models.find((m) => m.file === job.file);
        const abs =
          model && project?.folderPath
            ? await insideRoots(join(project.folderPath, job.file), rootPaths(db))
            : null;
        if (!abs) return fail("not_allowed");
        const slicers = [row.slicerIntegrationId, project?.slicerIntegrationId];
        const out = await slicePlate(db, adapters, { ...row, abs, model, slicers }, signal);
        done = {
          ...out.fingerprint,
          slicedAt: new Date().toISOString(),
          slicedPrintProfileId: out.profileId,
          slicedIntegrationId: out.integrationId,
          printTimeSeconds: out.result.printTimeSeconds,
          weightGrams: out.result.weightGrams,
          slicedFilaments: out.result.filaments,
        };
      } catch (e) {
        error = sliceErrorText(e, log, { job });
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
      if (error) onError?.(error);
      else success(log, { job }, "plate sliced");
    },
  };
}

/** One slice at a time, first in first out, in this process (ADR-0007). Only in memory. */
export function createSliceQueue(log: FastifyBaseLogger) {
  const queue: SliceJob[] = [];
  let running: SliceJob | null = null;
  const stop = new AbortController();

  async function pump() {
    if (running) return;
    while (!stop.signal.aborted) {
      running = queue.shift() ?? null;
      if (!running) break;
      await running.run(stop.signal).catch((err) => log.error({ err }, "slice job crashed"));
    }
    running = null;
  }

  return {
    /** Adds the jobs not already waiting; returns at once. */
    add(jobs: SliceJob[]) {
      for (const j of jobs)
        if (running?.key !== j.key && !queue.some((q) => q.key === j.key)) queue.push(j);
      void pump();
    },
    state(key: string): "queued" | "running" | null {
      if (running?.key === key) return "running";
      return queue.some((q) => q.key === key) ? "queued" : null;
    },
    close() {
      queue.length = 0;
      stop.abort();
    },
  };
}

export type SliceQueue = ReturnType<typeof createSliceQueue>;
