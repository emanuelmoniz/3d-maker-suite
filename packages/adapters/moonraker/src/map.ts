import type { ExternalPrint, PrinterSnapshot, PrintOutcome } from "@3d-maker-suite/core";
import { z } from "zod";

// Moonraker's answers and what they become. Pure: no requests here (index.ts makes them).
// Only the fields the app reads are described; everything else is ignored.

/** One Moonraker is one printer. Constant, so a changed address is still the same printer. */
export const PRINTER_ID = "klipper";

const num = z.number().nullish();

/** The slicer's totals, from `/server/files/metadata` or a history job's `metadata`. */
export const metadataSchema = z.object({
  layer_count: num,
  layer_height: num,
  first_layer_height: num,
  estimated_time: num,
  filament_type: z.string().nullish(),
  filament_colors: z.array(z.string()).nullish(),
  /** mm, every tool together. */
  filament_total: num,
  filament_weight_total: num,
  /** g, per tool. */
  filament_weights: z.array(z.number()).nullish(),
  printer_model: z.string().nullish(),
});
export type Metadata = z.infer<typeof metadataSchema>;

export const historyJobSchema = z.object({
  job_id: z.string().min(1),
  filename: z.string(),
  /** completed, cancelled, error, in_progress, klippy_shutdown, klippy_disconnect, interrupted... */
  status: z.string(),
  start_time: z.number(),
  total_duration: num,
  /** mm really extruded, every tool together. */
  filament_used: num,
  metadata: metadataSchema.nullish(),
  auxiliary_data: z
    .array(z.object({ provider: z.string(), name: z.string(), value: z.unknown() }))
    .nullish(),
});
export type HistoryJob = z.infer<typeof historyJobSchema>;

export const historyListSchema = z.object({
  result: z.object({ count: z.number(), jobs: z.array(historyJobSchema) }),
});

export const statusSchema = z.object({
  result: z.object({
    status: z.object({
      print_stats: z
        .object({
          filename: z.string().nullish(),
          total_duration: num,
          print_duration: num,
          filament_used: num,
          state: z.string(),
          message: z.string().nullish(),
          info: z.object({ total_layer: num, current_layer: num }).nullish(),
        })
        .optional(),
      virtual_sdcard: z.object({ progress: num }).nullish(),
      extruder: z.object({ temperature: num, target: num }).nullish(),
      heater_bed: z.object({ temperature: num, target: num }).nullish(),
      gcode_move: z.object({ gcode_position: z.array(z.number()).nullish() }).nullish(),
      webhooks: z.object({ state: z.string(), state_message: z.string().nullish() }).nullish(),
    }),
  }),
});
export type Status = z.infer<typeof statusSchema>["result"]["status"];

/** The objects `readStatus` asks for. */
export const STATUS_QUERY = "print_stats&virtual_sdcard&extruder&heater_bed&gcode_move&webhooks";

/** What the adapter knows of the job a status shows, beyond the status itself. */
export interface JobInfo {
  file: string;
  /** The history's id: the same print when the history backfills it. */
  jobId?: string;
  /** Unix seconds. */
  startTime?: number;
  meta?: Metadata;
  /** Moonraker's active Spoolman spool. */
  spoolId?: number;
}

const STATES: Record<string, PrinterSnapshot["state"]> = {
  standby: "idle",
  printing: "printing",
  paused: "paused",
  complete: "finished",
  cancelled: "cancelled",
  error: "error",
};
export const RUNNING = new Set(["printing", "paused"]);

const OUTCOMES: Record<string, PrintOutcome> = { completed: "success", cancelled: "cancelled" };

const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (unixSec: number) => new Date(unixSec * 1000).toISOString();
const firstLine = (s?: string | null) => s?.split("\n")[0]?.trim() || undefined;

/** "#F2754E" or "F2754EFF" -> "#F2754E"; anything else is dropped. */
function hex(c?: string) {
  const m = c?.match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  return m ? `#${m[1]}` : undefined;
}

/** "subdir/Cube.gcode" -> "Cube", as the job tracker titles a print from its file. */
export const fileTitle = (file: string) =>
  file
    .split(/[\\/]/)
    .pop()
    ?.replace(/(\.gcode)?\.[^.]+$/i, "") || file;

/**
 * The file's tools with their totals: one per entry of `filament_weights`, else one. A multi-tool
 * file leaves out the tools it doesn't use.
 */
function tools(meta?: Metadata | null) {
  const weights = meta?.filament_weights?.length
    ? meta.filament_weights
    : [meta?.filament_weight_total ?? undefined];
  const types = meta?.filament_type?.split(";").map((s) => s.trim());
  const all = weights.map((grams, slot) => ({
    slot,
    material: types?.[slot] || types?.[0] || undefined,
    colorHex: hex(meta?.filament_colors?.[slot] ?? undefined),
    grams: grams ?? undefined,
  }));
  return all.length > 1 ? all.filter((t) => (t.grams ?? 0) > 0) : all;
}

/**
 * What share of the file's filament went out: the length really extruded over the file's total.
 * undefined when the file has no total.
 */
function shareUsed(used?: number | null, meta?: Metadata | null) {
  const total = meta?.filament_total;
  if (!total || total <= 0 || used == null) return undefined;
  return Math.min(1, Math.max(0, used / total));
}

/** A Spoolman spool as the app's spool import keys it (the Spoolman adapter's `sourceSpool`). */
export const spoolKey = (id: number) => `spoolman:${id}`;

/** The Spoolman spools a history job names: Moonraker reported its usage to each of them. */
function spoolsOf(job: HistoryJob): number[] {
  const ids = job.auxiliary_data?.find((a) => a.provider === "spoolman" && a.name === "spool_ids");
  return z.array(z.number()).safeParse(ids?.value).data ?? [];
}

/**
 * What a slot says of Spoolman: the spool when the job names one for its only tool (several, a
 * spool change or more tools, are unsure), and that Moonraker already charged it whenever it names
 * any. `otherSpoolman`: Moonraker reports to another Spoolman than the app's, so neither holds.
 */
function spoolFields(ids: number[], tools: number, otherSpoolman?: boolean) {
  if (otherSpoolman || !ids.length) return {};
  const [only] = ids;
  return {
    ...(tools === 1 && ids.length === 1 && only != null && { spoolId: spoolKey(only) }),
    chargedAtSource: true,
  };
}

/**
 * A history job as a print: a finished one has the file's totals per tool; a stopped one the
 * length really extruded, against the file's totals (real grams, measured by the printer). A
 * multi-tool job's split of that length over its tools is a guess, so it is estimated.
 */
export function toPrint(job: HistoryJob, otherSpoolman?: boolean): ExternalPrint {
  const outcome = OUTCOMES[job.status] ?? "failed";
  const share = outcome === "success" ? 1 : shareUsed(job.filament_used, job.metadata);
  const slots = tools(job.metadata);
  const spool = spoolFields(spoolsOf(job), slots.length, otherSpoolman);
  return {
    externalId: job.job_id,
    printerExternalId: PRINTER_ID,
    title: fileTitle(job.filename),
    startedAt: iso(job.start_time),
    ...(job.total_duration != null && { durationSec: Math.round(job.total_duration) }),
    outcome,
    // `error` says nothing more; other end states name why (`klippy_shutdown`, `interrupted`).
    ...(outcome === "failed" && job.status !== "error" && { failureReason: job.status }),
    filaments: slots.map(({ grams, ...t }) => ({
      ...t,
      ...(grams != null && share != null && { grams: round2(grams * share) }),
      ...(grams != null &&
        share != null &&
        share < 1 &&
        slots.length > 1 && {
          gramsEstimated: true,
        }),
      ...spool,
    })),
  };
}

/** Layers: Klipper's own when the slicer sends them, else from Z and the file's layer heights. */
function layers(s: Status, meta?: Metadata) {
  const info = s.print_stats?.info;
  const totalLayers = info?.total_layer || meta?.layer_count || undefined;
  if (info?.current_layer != null) return { layer: info.current_layer, totalLayers };
  const z = s.gcode_move?.gcode_position?.[2];
  const h = meta?.layer_height;
  const first = meta?.first_layer_height ?? h;
  // Only while it extrudes: Z is the park or homing height before the first layer and when paused.
  if (
    s.print_stats?.state !== "printing" ||
    !s.print_stats.filament_used ||
    z == null ||
    !h ||
    !first
  )
    return { totalLayers };
  // Layer 1 tops out at the first layer's height, each next one a layer height higher.
  const layer = z <= first + 1e-6 ? 1 : Math.ceil((z - first) / h - 1e-6) + 1;
  return { layer: totalLayers ? Math.min(layer, totalLayers) : layer, totalLayers };
}

/**
 * A status read as a snapshot. `info` is what the adapter learnt of the job it shows. An active
 * Spoolman spool means Moonraker reports the job's usage to it (unless `otherSpoolman`).
 */
export function toSnapshot(
  s: Status,
  at: string,
  info?: JobInfo,
  otherSpoolman?: boolean,
): PrinterSnapshot {
  const ps = s.print_stats;
  const klippy = s.webhooks?.state ?? "ready";
  let state: PrinterSnapshot["state"] = (ps && STATES[ps.state]) || "idle";
  // Klipper shut down: the firmware stopped whatever it was doing.
  if (klippy === "shutdown" || klippy === "error") state = "error";
  else if (klippy !== "ready") state = "offline";
  const file = ps?.filename || undefined;
  const meta = info?.file === file ? info?.meta : undefined;
  const temperatures = {
    ...(s.extruder?.temperature != null && { nozzle: s.extruder.temperature }),
    ...(s.extruder?.target != null && { nozzleTarget: s.extruder.target }),
    ...(s.heater_bed?.temperature != null && { bed: s.heater_bed.temperature }),
    ...(s.heater_bed?.target != null && { bedTarget: s.heater_bed.target }),
  };
  const snap: PrinterSnapshot = {
    printerExternalId: PRINTER_ID,
    at,
    state,
    temperatures,
    slots: [],
  };
  if (state === "idle" || state === "offline" || !file) return snap;

  const ours = info?.file === file ? info : undefined;
  const running = RUNNING.has(ps?.state ?? "");
  const progress = s.virtual_sdcard?.progress;
  const done = ps?.print_duration ?? 0;
  // The file's position says how far it is; before it moves, the slicer's estimate.
  const eta =
    progress && progress > 0.01
      ? done / progress - done
      : meta?.estimated_time
        ? meta.estimated_time - done
        : undefined;
  const share = shareUsed(ps?.filament_used, meta);
  const slots = tools(meta);
  const failureReason =
    state === "error"
      ? firstLine(ps?.message) ||
        (klippy === "ready" ? undefined : firstLine(s.webhooks?.state_message))
      : undefined;
  snap.job = {
    ...(ours?.jobId && { id: ours.jobId }),
    file,
    ...(ours?.startTime && { startedAt: iso(ours.startTime) }),
    ...(ps?.total_duration != null && { elapsedSec: Math.round(ps.total_duration) }),
    // After a cancel the file's position is reset to 0; the tracker keeps the highest seen.
    ...(progress != null && { progress: round2(Math.min(100, progress * 100)) }),
    ...(running && eta != null && { etaSec: Math.max(0, Math.round(eta)) }),
    ...layers(s, meta),
    ...(meta && { slots: slots.map((t) => t.slot) }),
    ...(failureReason && { failureReason }),
  };
  const spool = spoolFields(
    ours?.spoolId != null ? [ours.spoolId] : [],
    slots.length,
    otherSpoolman,
  );
  snap.slots = slots.map(({ grams, ...t }) => ({
    ...t,
    ...spool,
    ...(slots.length === 1 && { active: running }),
    ...(grams != null && share != null && { gramsUsed: round2(grams * share) }),
  }));
  return snap;
}
