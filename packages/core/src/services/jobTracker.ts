import type { PrintOutcome } from "../schemas/enums.ts";
import type { ExternalPrint, PrinterSnapshot } from "../schemas/integrations.ts";

// Turns what a printer is doing into the prints it made (ADR-0015). Pure: the state of one printer
// and its next snapshot in, the new state and the prints that ended out. The state is plain JSON,
// so whoever calls it can keep it across a restart.

type Slot = Omit<PrinterSnapshot["slots"][number], "active">;

/** What the tracker remembers of a running job. */
export interface TrackedJob {
  // The first value seen is kept: the snapshot that ends a job often has no file and no ids.
  id?: string;
  peerId?: string;
  file?: string;
  title?: string;
  plate?: number;
  /** The slots the printer said up front the job uses. */
  planned?: number[];
  /** The printer's own start, else when the job was first seen minus what it had printed by then. */
  startedAt: string;
  /** First seen while already printing: the start is a guess and a slot may be missing. */
  partial: boolean;
  /** The last snapshot that showed it. */
  lastAt: string;
  // The highest seen: a printer may reset them in the snapshot that ends the job.
  elapsedSec?: number;
  progress?: number;
  layer?: number;
  totalLayers?: number;
  /** The job file's slicer totals, when the source read them (it may take a few snapshots). */
  totals?: { slot?: number; grams: number }[];
  /** The slots it used, as first described; `gramsUsed` is the latest. */
  slots: Slot[];
}

/**
 * `unknown`: not watching (nothing seen yet, or the printer went out of sight with no job).
 * `idle`: watching and no job runs; the printer may still show one that ended. An end state only
 * makes a print out of an `active` job, so two end events for one job are one print.
 */
export type TrackerState = { phase: "unknown" | "idle" } | { phase: "active"; job: TrackedJob };

export interface TrackedPrint {
  /** A slot's `grams` only when the printer measured them. */
  print: ExternalPrint;
  /** The job was first seen while already printing: its duration is a guess, its slots unsure. */
  partial: boolean;
  /** False: the job was gone with no end state, so the outcome is a guess from its progress. */
  endSeen: boolean;
  /** How far it got and its file, for the grams the printer didn't report. */
  job: Pick<TrackedJob, "file" | "progress" | "layer" | "totalLayers" | "totals">;
}

const OUTCOMES: Partial<Record<PrinterSnapshot["state"], PrintOutcome>> = {
  finished: "success",
  cancelled: "cancelled",
  error: "failed",
};

const seconds = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
const highest = (a?: number, b?: number) => (a == null || b == null ? (a ?? b) : Math.max(a, b));

/**
 * The same job unless both name an id, or (without two ids) both a file, and they differ. In doubt
 * it is one job: two prints of one job would charge a spool twice.
 */
function sameJob(job: TrackedJob, next: PrinterSnapshot["job"]) {
  if (job.id && next?.id) return job.id === next.id;
  return !(job.file && next?.file && job.file !== next.file);
}

function withSlots(job: TrackedJob, snap: PrinterSnapshot): Slot[] {
  const slots = [...job.slots];
  for (const { active, ...s } of snap.slots) {
    const i = slots.findIndex((x) => x.slot === s.slot);
    const known = slots[i];
    const used = job.planned ? job.planned.includes(s.slot) : active || !!s.gramsUsed;
    if (known) slots[i] = { ...s, ...known, gramsUsed: s.gramsUsed ?? known.gramsUsed };
    else if (used) slots.push(s);
  }
  return slots;
}

/** The job with what this snapshot adds. */
function merge(job: TrackedJob, snap: PrinterSnapshot): TrackedJob {
  const j = snap.job ?? {};
  const next: TrackedJob = {
    ...job,
    id: job.id ?? j.id,
    peerId: job.peerId ?? j.peerId,
    file: job.file ?? j.file,
    title: job.title ?? j.title,
    plate: job.plate ?? j.plate,
    planned: job.planned ?? j.slots,
    // The printer's own start is the truth whenever it comes.
    startedAt: j.startedAt ?? job.startedAt,
    lastAt: snap.at,
    elapsedSec: highest(job.elapsedSec, j.elapsedSec),
    progress: highest(job.progress, j.progress),
    layer: highest(job.layer, j.layer),
    totalLayers: job.totalLayers ?? j.totalLayers,
    totals: job.totals ?? j.totals,
  };
  return { ...next, slots: withSlots(next, snap) };
}

function start(snap: PrinterSnapshot, partial: boolean): TrackedJob {
  const startedAt = new Date(
    Date.parse(snap.at) - (snap.job?.elapsedSec ?? 0) * 1000,
  ).toISOString();
  return merge({ startedAt, partial, lastAt: snap.at, slots: [] }, snap);
}

/** "/usb/Tablet Stand.gcode.3mf" -> "Tablet Stand". */
const fileTitle = (file?: string) =>
  file
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/(\.gcode)?\.[^.]+$/i, "");

function toPrint(
  printerExternalId: string,
  job: TrackedJob,
  end: { at: string; outcome: PrintOutcome; seen: boolean; failureReason?: string },
): TrackedPrint {
  const slots = job.planned
    ? job.planned.map((slot) => job.slots.find((s) => s.slot === slot) ?? { slot })
    : [...job.slots].sort((a, b) => a.slot - b.slot);
  return {
    print: {
      // No id from the printer: the start tells two prints of one file apart.
      externalId: job.id ?? job.startedAt,
      ...(job.peerId && { peerId: job.peerId }),
      printerExternalId,
      title: job.title ?? (fileTitle(job.file) || job.id || job.startedAt),
      ...(job.plate && { plate: job.plate }),
      startedAt: job.startedAt,
      // ponytail: an end first seen long after it happened (the app was off) makes this too long
      // on a printer that doesn't report its own time; record when the state was last seen if it
      // matters.
      durationSec: job.elapsedSec ?? seconds(job.startedAt, end.at),
      outcome: end.outcome,
      ...(end.outcome !== "success" && end.failureReason && { failureReason: end.failureReason }),
      filaments: slots.map(({ gramsUsed, ...s }) => ({
        ...s,
        ...(gramsUsed != null && { grams: gramsUsed }),
      })),
    },
    partial: job.partial,
    endSeen: end.seen,
    job: {
      file: job.file,
      progress: job.progress,
      layer: job.layer,
      totalLayers: job.totalLayers,
      ...(job.totals && { totals: job.totals }),
    },
  };
}

/** A job that is gone with no end state: done if it had reached the end, else failed. */
const gone = (printerExternalId: string, job: TrackedJob) =>
  toPrint(printerExternalId, job, {
    at: job.lastAt,
    outcome: (job.progress ?? 0) >= 100 ? "success" : "failed",
    seen: false,
  });

export function track(
  state: TrackerState,
  snap: PrinterSnapshot,
): { state: TrackerState; prints: TrackedPrint[] } {
  const id = snap.printerExternalId;
  const outcome = OUTCOMES[snap.state];
  const running = !outcome && snap.state !== "idle" && snap.state !== "offline";
  // First seen while printing, by a tracker that wasn't watching it start.
  const begin = (watched: boolean): TrackerState => ({
    phase: "active",
    job: start(snap, !watched && snap.state !== "preparing"),
  });

  if (state.phase !== "active") {
    if (running) return { state: begin(state.phase !== "unknown"), prints: [] };
    // An end state with no job watched is an old job's: never a print.
    const phase = snap.state === "offline" ? "unknown" : "idle";
    return { state: { phase }, prints: [] };
  }

  const { job } = state;
  // Out of sight during a job: it is still the job when the printer is back.
  if (snap.state === "offline") return { state, prints: [] };
  if (snap.state === "idle") return { state: { phase: "idle" }, prints: [gone(id, job)] };
  if (!sameJob(job, snap.job))
    return { state: running ? begin(false) : { phase: "idle" }, prints: [gone(id, job)] };
  const now = merge(job, snap);
  if (!outcome) return { state: { phase: "active", job: now }, prints: [] };
  const end = { at: snap.at, outcome, seen: true, failureReason: snap.job?.failureReason };
  return { state: { phase: "idle" }, prints: [toPrint(id, now, end)] };
}
