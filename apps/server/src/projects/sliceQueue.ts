import { parse3mf } from "@3d-maker-suite/3mf";
import {
  type IntegrationAdapter,
  IntegrationError,
  type ProjectModel,
  pickSlicer,
  projectMetaSchema,
  resolvePlate,
  type SLICE_JOB_STATES,
  type SliceRequest,
  type SliceRun,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { capableRows, presetLibrary, slicerConfigDir } from "../integrations/capabilities.ts";
import { usedPresets } from "../integrations/presetLibrary.ts";
import { success } from "../lib/logSink.ts";
import { readPreferences } from "../lib/preferences.ts";
import { fingerprint } from "./fingerprint.ts";
import { projectFile } from "./rootFs.ts";

const { brands, filamentPresets, machinePresets, printerModels, printers } = schema;
const { processPresets, projectSlicePlates, projects } = schema;

/** Stored in `sliceError` as `code` or `code: detail` (the detail is the slicer's own text). */
export const SLICE_ERRORS = [
  "no_slicer",
  "not_allowed",
  "no_preset",
  "no_machine_preset",
  "no_printer_preset",
  "empty_plate",
  "slice_failed",
] as const;

type PlateRow = typeof projectSlicePlates.$inferSelect;
type IntegrationRow = typeof schema.integrations.$inferSelect;
type PlateChoice = Pick<
  PlateRow,
  "printerId" | "machinePresetId" | "processPresetId" | "useDefaultProcessPreset"
>;
type FileInfo = Pick<ProjectModel, "printerModel" | "nozzleDiameter">;
type SliceJobState = (typeof SLICE_JOB_STATES)[number];

/** Anything the queue runs; `key` tells whether the same work is already waiting. */
export type SliceJob = { key: string; run: (signal: AbortSignal) => Promise<void> };
export type ProjectPlate = { projectId: string; file: string; plate: number };
export const projectJobKey = (j: ProjectPlate) => `project:${j.projectId}#${j.file}#${j.plate}`;

/**
 * Resolves the slicer integration of `picks` (a plate's, its project's) with the slicers that can
 * slice now: the first that can, else the default slicer, else the first one (`pickSlicer`).
 */
export function slicerResolver(db: Db, adapters: IntegrationAdapter[], here = false) {
  // `here`: only the server's own slicers, no slice workers (a waiting plate's fallback).
  const rows = capableRows(db, adapters, "slice").filter(
    (r) => !here || r.adapter.kind !== "worker",
  );
  const ids = rows.map((r) => r.row.id);
  const { defaultSlicerId } = readPreferences(db);
  return (picks: (string | null | undefined)[] = []) => {
    const id = pickSlicer(ids, [...picks, defaultSlicerId]);
    return rows.find((r) => r.row.id === id);
  };
}

/**
 * Sliced with another slicer than `now` resolves to, or another version of it (ADR-0013). A null
 * slicer (sliced before 0072 stored it) was the default slicer, `fallback` (what no picks resolve
 * to); a null version (a local slicer, or before 0073) is the current one. ponytail: so a later
 * change of the default itself leaves those slices current; they re-slice once anything else changes.
 */
export const slicedWithOther = (
  sliced: Pick<PlateRow, "slicedIntegrationId" | "slicedSlicerVersion">,
  now: Pick<IntegrationRow, "id" | "slicerVersion"> | undefined,
  fallback: string | undefined,
) =>
  (sliced.slicedIntegrationId ?? fallback) !== now?.id ||
  (sliced.slicedSlicerVersion ?? now?.slicerVersion) !== now?.slicerVersion;

export const sliceIntegration = (
  db: Db,
  adapters: IntegrationAdapter[],
  picks?: (string | null | undefined)[],
  here = false,
) => slicerResolver(db, adapters, here)(picks);

/** The slice worker's device is offline: the job waits in the queue until a device connects. */
export class SliceWait extends Error {}

/** How a worker integration's slices run on its device (workerSlicer.ts); one per app. */
const workerRuns = new WeakMap<Db, (integrationId: string) => SliceRun>();
export const useSliceWorkers = (db: Db, run: (integrationId: string) => SliceRun) =>
  void workerRuns.set(db, run);

/**
 * How a plate slices with a slicer of `library` (`resolvePlate`, as the page resolves it): its
 * printer, machine preset and process preset.
 */
export function plateResolver(db: Db) {
  const { defaultPrinterId } = readPreferences(db);
  const all = db
    .select({
      id: printers.id,
      name: printers.name,
      modelId: printers.modelId,
      nozzleDiameterMm: printers.nozzleDiameterMm,
      processPresetId: printers.processPresetId,
      machinePresetId: printers.machinePresetId,
      archivedAt: printers.archivedAt,
      model: printerModels.model,
      brand: brands.name,
    })
    .from(printers)
    .leftJoin(printerModels, eq(printerModels.id, printers.modelId))
    .leftJoin(brands, eq(brands.id, printerModels.brandId))
    .all()
    .map((p) => ({ ...p, model: p.model ?? "" }));
  // ponytail: every machine and process preset per call (a few thousand rows); fine locally.
  const machines = db.select().from(machinePresets).all();
  const prints = db
    .select({
      id: processPresets.id,
      printerModelId: processPresets.printerModelId,
      sourcePreset: processPresets.sourcePreset,
      machinePresets: processPresets.machinePresets,
      archivedAt: processPresets.archivedAt,
    })
    .from(processPresets)
    .all();
  return (row: PlateChoice, file: FileInfo | undefined, library: string | undefined) =>
    resolvePlate(row, file ?? { printerModel: null, nozzleDiameter: null }, {
      printers: all,
      defaultPrinterId,
      machines,
      prints,
      library,
    });
}

class SliceError extends Error {}
const fail = (code: (typeof SLICE_ERRORS)[number], detail?: string): never => {
  throw new SliceError(detail ? `${code}: ${detail}` : code);
};

/**
 * A plate to slice: the 3MF (absolute, already checked), its info, the preset choices, and the
 * slicer picks (the plate's, its project's; see `sliceIntegration`). `here`: the server's own
 * slicers only.
 */
export type PlateToSlice = PlateChoice & {
  abs: string;
  plate: number;
  model: FileInfo | undefined;
  filaments: (string | null)[];
  slicers: (string | null | undefined)[];
  here?: boolean;
};

/**
 * Slices one plate with the slicer integration: the plate's printer, process preset and filament
 * per slot, as presets of that slicer. Throws `SliceError` (code, see `SLICE_ERRORS`) or the
 * slicer's own error; `sliceErrorText` turns either into the stored text.
 */
export async function slicePlate(
  db: Db,
  adapters: IntegrationAdapter[],
  p: PlateToSlice,
  signal: AbortSignal,
) {
  const found = sliceIntegration(db, adapters, p.slicers, p.here);
  const slicer = found?.adapter.slicer;
  if (!found || !slicer) return fail("no_slicer");
  const run = found.adapter.kind === "worker" ? workerRuns.get(db)?.(found.row.id) : undefined;
  if (found.adapter.kind === "worker" && !run) return fail("no_slicer");
  // Presets are named `<library>:<preset id>`; only this slicer's own can be passed to it.
  const prefix = `${presetLibrary(found.adapter)}:`;
  const own = (source: string | null | undefined) =>
    source?.startsWith(prefix) ? source.slice(prefix.length) : undefined;

  const library = presetLibrary(found.adapter);
  const { printer, machine, fromFile, presetId } = plateResolver(db)(p, p.model, library);
  const req: SliceRequest = { file: p.abs, plate: p.plate };
  if (presetId) {
    const row = db.select().from(processPresets).where(eq(processPresets.id, presetId)).get();
    req.process = own(row?.sourcePreset);
    if (!req.process) fail("no_preset", row?.name);
  }
  if (printer && !fromFile) {
    // Not the file's machine: the plate's or printer's machine preset, a system preset of this
    // slicer (ADR-0007: only those slice).
    if (!req.process) fail("no_printer_preset", printer.name);
    const id = own(machine?.sourcePreset);
    req.machine = id?.startsWith("system/") ? id : undefined;
    if (!req.machine) fail("no_machine_preset", printer.name);
  }
  if (p.filaments.some(Boolean)) {
    const ids = p.filaments.filter((f): f is string => !!f);
    const presets = new Map(
      db
        .select({ id: filamentPresets.id, source: filamentPresets.sourcePreset })
        .from(filamentPresets)
        .where(inArray(filamentPresets.id, ids))
        .all()
        .map((f) => [f.id, own(f.source)]),
    );
    // ponytail: a hand-made filament, or another slicer's preset (Bambu Studio <-> OrcaSlicer),
    // keeps the 3MF's own for slicing (grams barely change within a material); its price still
    // counts. Ask for a preset if that turns out wrong.
    req.filaments = p.filaments.map((f) => (f && presets.get(f)) || null);
  }

  const before = await fingerprint(p.abs);
  if (!before) return fail("not_allowed");
  // The CLI reports a plate without objects as an unparsable model (-6).
  const info = await parse3mf(p.abs).catch(() => null);
  const onPlate = info?.plates.find((x) => x.index === p.plate);
  if (info && !onPlate?.objects.length) fail("empty_plate", String(p.plate));
  const result = await slicer.slice(
    found.row.slicerPath ?? "",
    slicerConfigDir(found.row, found.adapter) ?? "",
    req,
    signal,
    run,
  );
  const presets = usedPresets(db, library, req);
  return { fingerprint: before, presetId, slicer: found.row, presets, result };
}

/** The error text stored for a failed slice; unexpected errors are logged. A wait isn't one. */
export function sliceErrorText(e: unknown, log: FastifyBaseLogger, context: object): string {
  if (e instanceof SliceWait) throw e;
  if (e instanceof SliceError) return e.message;
  if (e instanceof IntegrationError && e.code === "slice_failed") return e.message;
  log.warn({ err: e, ...context }, "slice failed");
  return "slice_failed";
}

/**
 * Slices a plate of a project's setup; its result or error goes to its `project_slice_plates` row.
 * `onError` hears a stored error (auto slices raise an alert with it). `here`: see `PlateToSlice`.
 */
export function projectSliceJob(
  db: Db,
  adapters: IntegrationAdapter[],
  log: FastifyBaseLogger,
  job: ProjectPlate & { here?: boolean },
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
        const abs = model && project ? await projectFile(db, project, job.file) : null;
        if (!abs) return fail("not_allowed");
        const slicers = [row.slicerIntegrationId, project?.slicerIntegrationId];
        const out = await slicePlate(
          db,
          adapters,
          { ...row, abs, model, slicers, here: job.here },
          signal,
        );
        done = {
          ...out.fingerprint,
          slicedAt: new Date().toISOString(),
          slicedProcessPresetId: out.presetId,
          slicedIntegrationId: out.slicer.id,
          slicedSlicerVersion: out.slicer.slicerVersion,
          slicedPresets: out.presets,
          printTimeSeconds: out.result.printTimeSeconds,
          weightGrams: out.result.weightGrams,
          slicedFilaments: out.result.filaments,
        };
      } catch (e) {
        error = sliceErrorText(e, log, { job });
      }
      // Only if the plate still has the presets it was sliced with (the setup may have been saved).
      const now = db.select().from(projectSlicePlates).where(where).get();
      if (
        !now ||
        now.printerId !== row.printerId ||
        now.machinePresetId !== row.machinePresetId ||
        now.processPresetId !== row.processPresetId ||
        now.useDefaultProcessPreset !== row.useDefaultProcessPreset ||
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

/**
 * One slice at a time, first in first out, in this process (ADR-0007). Only in memory. A job whose
 * slice worker is offline (`SliceWait`) is set aside without blocking the others, and runs again
 * on `wake`.
 */
export function createSliceQueue(log: FastifyBaseLogger) {
  const queue: SliceJob[] = [];
  const waiting = new Map<string, SliceJob>();
  let running: SliceJob | null = null;
  const stop = new AbortController();

  async function pump() {
    if (running) return;
    while (!stop.signal.aborted) {
      const job = queue.shift();
      if (!job) break;
      running = job;
      await job.run(stop.signal).catch((err) => {
        if (err instanceof SliceWait) waiting.set(job.key, job);
        else log.error({ err }, "slice job crashed");
      });
    }
    running = null;
  }

  return {
    /** Adds the jobs not already queued or waiting; returns at once. */
    add(jobs: SliceJob[]) {
      for (const j of jobs)
        if (running?.key !== j.key && !waiting.has(j.key) && !queue.some((q) => q.key === j.key))
          queue.push(j);
      void pump();
    },
    state(key: string): SliceJobState | null {
      if (running?.key === key) return "running";
      if (waiting.has(key)) return "waiting";
      return queue.some((q) => q.key === key) ? "queued" : null;
    },
    /**
     * The waiting jobs go back in line: a device came online, or slicing was asked for again.
     * ponytail: all of them; the ones whose worker is still offline set themselves aside at once.
     */
    wake() {
      queue.push(...waiting.values());
      waiting.clear();
      void pump();
    },
    /** Forgets a waiting job, so `add` can queue it another way (the server's own slicer). */
    drop: (key: string) => void waiting.delete(key),
    close() {
      queue.length = 0;
      waiting.clear();
      stop.abort();
    },
  };
}

export type SliceQueue = ReturnType<typeof createSliceQueue>;
