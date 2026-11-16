import type { JobTotal } from "@3d-maker-suite/3mf";
import type { PrinterSnapshot } from "@3d-maker-suite/core";
import { z } from "zod";

// PrusaLink's answers (`/api/v1/status`, `/api/v1/job`) and what they become. Pure: no requests
// here (index.ts makes them). Only the fields the app reads are described.
// Payloads: packages/adapters/prusalink/fixtures (Home Assistant's tests: no printer confirmed them).

/** One PrusaLink is one printer. Constant, so a changed address is still the same printer. */
export const PRINTER_ID = "prusalink";

const num = z.number().nullish();

export const statusSchema = z.object({
  job: z
    .object({ id: z.number(), progress: num, time_remaining: num, time_printing: num })
    .nullish(),
  printer: z.object({
    /** IDLE, BUSY, READY, PRINTING, PAUSED, ATTENTION, FINISHED, STOPPED, ERROR. */
    state: z.string(),
    temp_bed: num,
    target_bed: num,
    temp_nozzle: num,
    target_nozzle: num,
  }),
});
export type Status = z.infer<typeof statusSchema>;

const fileSchema = z.object({
  name: z.string(),
  display_name: z.string().nullish(),
  size: num,
  refs: z.object({ download: z.string().nullish() }).nullish(),
});

/** `/api/v1/job`: the job's file. The MK4, XL and MINI send no filament totals in it. */
export const jobSchema = z.object({ id: z.number(), file: fileSchema.nullish() });
export type Job = z.infer<typeof jobSchema>;

/** `/api/v1/info`. */
export const infoSchema = z.object({
  hostname: z.string().nullish(),
  serial: z.string().nullish(),
  nozzle_diameter: z.number().nullish(),
});

/** `/api/printer`, the only place the loaded material is named. */
export const legacyPrinterSchema = z.object({
  telemetry: z.object({ material: z.string().nullish() }).nullish(),
});

const STATES: Record<string, PrinterSnapshot["state"]> = {
  IDLE: "idle",
  BUSY: "idle",
  READY: "idle",
  PRINTING: "printing",
  PAUSED: "paused",
  // The printer waits for a person (filament out, a door): the print is held, not over.
  ATTENTION: "paused",
  FINISHED: "finished",
  STOPPED: "cancelled",
  ERROR: "error",
};
/** A job that is on its way: its file and totals are read while it is. */
export const RUNNING = new Set(["PRINTING", "PAUSED", "ATTENTION"]);

/** What the adapter knows of the job a status shows, beyond the status itself. */
export interface JobInfo {
  id: number;
  file?: string;
  /** Where the file can be downloaded (a path on the printer). */
  download?: string;
  size?: number;
  /** The slicer's grams, once the file was read. */
  totals?: JobTotal[];
  material?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A status read as a snapshot. `info` is what the adapter learnt of the job it shows. */
export function toSnapshot(s: Status, at: string, info?: JobInfo): PrinterSnapshot {
  const p = s.printer;
  const state = STATES[p.state] ?? "idle";
  const snap: PrinterSnapshot = {
    printerExternalId: PRINTER_ID,
    at,
    state,
    temperatures: {
      ...(p.temp_nozzle != null && { nozzle: p.temp_nozzle }),
      ...(p.target_nozzle != null && { nozzleTarget: p.target_nozzle }),
      ...(p.temp_bed != null && { bed: p.temp_bed }),
      ...(p.target_bed != null && { bedTarget: p.target_bed }),
    },
    slots: [],
  };
  // An idle printer keeps its last job on some firmware (the MK3): it is not one now.
  if (state === "idle" || !s.job) return snap;
  const ours = info?.id === s.job.id ? info : undefined;
  const j = s.job;
  const left = j.time_remaining;
  snap.job = {
    id: String(j.id),
    ...(ours?.file && { file: ours.file }),
    ...(j.time_printing != null &&
      j.time_printing >= 0 && { elapsedSec: Math.round(j.time_printing) }),
    ...(j.progress != null && { progress: round2(Math.min(100, Math.max(0, j.progress))) }),
    ...(state === "printing" && left != null && left >= 0 && { etaSec: Math.round(left) }),
    ...(ours?.totals && { totals: ours.totals.map(({ slot, grams }) => ({ slot, grams })) }),
  };
  // The tools the file uses (an XL leaves the others at 0 g), else the one the printer has.
  const used = ours?.totals?.filter((t) => t.slot != null && t.grams > 0).map((t) => t.slot ?? 0);
  const slots = used?.length ? used : [0];
  if (used?.length) snap.job.slots = used;
  snap.slots = slots.map((slot) => ({
    slot,
    ...(slots.length === 1 && ours?.material && { material: ours.material }),
    active: state === "printing" || state === "paused",
  }));
  return snap;
}
