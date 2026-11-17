import type { PrinterSnapshot } from "@3d-maker-suite/core";
import { z } from "zod";

// What a Bambu printer reports on its local MQTT feed (ADR-0015, fixtures/lan/SOURCE.md), as a
// printer snapshot. Pure: the adapter keeps the merged report and the job it belongs to.
// A full report comes on `pushall`, then only what changed (about every 2 s).

/** The `print` part of the reports so far, merged. */
export type Report = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A report merged into what was known: objects key by key, arrays and values replaced. */
export function mergeReport(known: Report, next: Report): Report {
  const out: Report = { ...known };
  for (const [k, v] of Object.entries(next)) {
    const was = out[k];
    out[k] = isObject(was) && isObject(v) ? mergeReport(was, v) : v;
  }
  return out;
}

/** `print_error` of a print stopped on the printer or in the app: a cancel, not a failure. */
export const CANCELLED = 0x0300400c;

/** "0300-8001", as Bambu's error pages write it. */
const errorCode = (n: number) => {
  const hex = n.toString(16).toUpperCase().padStart(8, "0");
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
};

const RUNNING = new Set(["PREPARE", "SLICING", "RUNNING", "PAUSE"]);
const STATES: Record<string, PrinterSnapshot["state"]> = {
  IDLE: "idle",
  PREPARE: "preparing",
  SLICING: "preparing",
  RUNNING: "printing",
  PAUSE: "paused",
  FINISH: "finished",
};
export const isRunning = (r: Report) => RUNNING.has(String(r.gcode_state ?? ""));
export const isEnd = (r: Report) => r.gcode_state === "FINISH" || r.gcode_state === "FAILED";

/** A slot the AMS doesn't use (`ams_mapping`, `tray_now`); 254 is the spool on the back. */
const NONE = 255;
export const EXTERNAL = 254;

/** The start command the printer echoes when a print is sent to it (`project_file`). */
export interface Start {
  taskId?: string;
  /** 1-based plate of the project file. */
  plate?: number;
  /** The slot of each of the file's filaments, by filament (index 0 = filament 1). */
  mapping?: number[];
  /** The sender's start time, to the second (the cloud's own `startTime`). */
  startedAt?: string;
}

const startSchema = z.object({
  command: z.literal("project_file"),
  task_id: z.coerce.string().optional(),
  plate_idx: z.coerce.number().int().optional(),
  param: z.string().optional(),
  ams_mapping: z.array(z.number()).optional(),
  use_ams: z.boolean().optional(),
  timestamp: z.number().optional(),
});

/** The start command in a report, if it is one. */
export function startOf(print: Report): Start | undefined {
  const s = startSchema.safeParse(print);
  if (!s.success) return;
  const p = s.data;
  const plate = p.plate_idx ?? Number(/plate_(\d+)\.gcode$/.exec(p.param ?? "")?.[1]);
  return {
    ...(p.task_id && p.task_id !== "0" && { taskId: p.task_id }),
    ...(Number.isInteger(plate) && plate > 0 && { plate }),
    // Without the AMS every filament comes from the spool on the back.
    mapping: p.use_ams === false ? [EXTERNAL] : p.ams_mapping,
    ...(p.timestamp && { startedAt: new Date(p.timestamp * 1000).toISOString() }),
  };
}

/** A real slot of the mapping: the AMS trays and the spool on the back, not "unused". */
const used = (slot: number | undefined): slot is number =>
  slot != null && Number.isInteger(slot) && slot >= 0 && slot < NONE;

/**
 * The file's totals (`readJobTotals`, numbered by the file's filament) on the printer's slots. One
 * filament on one slot needs no mapping. A total the mapping can't place is dropped: a wrong slot
 * would charge the wrong spool, and the plate or the review fills it.
 */
export function totalsOnSlots(
  totals: { slot?: number; grams: number }[],
  mapping: number[] | undefined,
  active?: number,
): { slot: number; grams: number }[] {
  const slots = mapping?.filter(used) ?? (used(active) ? [active] : []);
  const one = totals.length === 1 && slots.length === 1 ? slots[0] : undefined;
  return totals.flatMap((t) => {
    const slot = one ?? (t.slot != null ? mapping?.[t.slot] : undefined);
    return used(slot) ? [{ slot, grams: t.grams }] : [];
  });
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const text = (v: unknown) => (typeof v === "string" && v && v !== "0" ? v : undefined);
const nonNegative = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? Math.round(n) : undefined;
};

const traySchema = z.object({
  id: z.coerce.number().int(),
  tray_type: z.string().optional(),
  tray_color: z.string().optional(),
  tray_uuid: z.string().optional(),
});
const amsSchema = z.object({
  ams: z
    .array(z.object({ id: z.coerce.number().int(), tray: z.array(traySchema).default([]) }))
    .default([]),
  tray_now: z.coerce.number().optional(),
});

/**
 * A tray's slot, as the start command and the cloud number it: AMS `n` holds 4n to 4n+3. An AMS
 * HT (id 128 and up) has one tray and is numbered by its id.
 */
const slotOf = (ams: number, tray: number) => (ams >= 128 ? ams : ams * 4 + tray);

function slot(
  n: number,
  t: z.infer<typeof traySchema>,
  now?: number,
): PrinterSnapshot["slots"][number] | undefined {
  if (!t.tray_type) return; // an empty tray
  const color = /^[0-9a-f]{6}/i.exec(t.tray_color ?? "")?.[0];
  // A spool without Bambu's tag reads as zeros.
  const rfid = t.tray_uuid && /[1-9a-f]/i.test(t.tray_uuid) ? t.tray_uuid : undefined;
  return {
    slot: n,
    material: t.tray_type,
    ...(color && { colorHex: `#${color.toLowerCase()}` }),
    ...(rfid && { rfid }),
    ...(now === n && { active: true }),
  };
}

/** Every loaded tray of every AMS, then the spool on the back. */
export function slotsOf(r: Report): PrinterSnapshot["slots"] {
  const ams = amsSchema.safeParse(r.ams ?? {});
  const now = ams.success ? ams.data.tray_now : undefined;
  const trays = ams.success
    ? ams.data.ams.flatMap((a) => a.tray.map((t) => slot(slotOf(a.id, t.id), t, now)))
    : [];
  const back = traySchema.omit({ id: true }).safeParse(r.vt_tray ?? {});
  if (back.success) trays.push(slot(EXTERNAL, { ...back.data, id: EXTERNAL }, now));
  return trays.filter((t) => !!t);
}

/** What the adapter knows of the job the report shows, beyond the report itself. */
export interface Job {
  start?: Start;
  /** The file's totals on the printer's slots, once the file was read. */
  totals?: { slot: number; grams: number }[];
  /** How it ended, set the moment it did: `print_error` is back to 0 four seconds later. */
  end?: { state: "finished" | "cancelled" | "error"; failureReason?: string };
}

/** How the job that just reached FINISH or FAILED ended. */
export function endOf(r: Report): NonNullable<Job["end"]> {
  if (r.gcode_state === "FINISH") return { state: "finished" };
  const code = num(r.print_error) ?? 0;
  if (code === CANCELLED) return { state: "cancelled" };
  return { state: "error", ...(code > 0 && { failureReason: errorCode(code) }) };
}

/** Models that have no chamber sensor send a made-up chamber temperature. */
const NO_CHAMBER = /^(A1|P1)/i;

export function toSnapshot(
  serial: string,
  r: Report,
  at: string,
  job: Job,
  model?: string,
): PrinterSnapshot {
  const raw = String(r.gcode_state ?? "");
  const state = raw === "FAILED" ? (job.end?.state ?? endOf(r).state) : (STATES[raw] ?? "idle");
  const start = job.start;
  const task = text(r.task_id);
  // P1 and X1 send their own start in seconds; the A1 sends none, so only the start command has it.
  const own = num(r.gcode_start_time);
  const startedAt = start?.startedAt ?? (own ? new Date(own * 1000).toISOString() : undefined);
  const total = nonNegative(r.total_layer_num);
  const failureReason = state === "error" ? job.end?.failureReason : undefined;
  const t = {
    nozzle: num(r.nozzle_temper),
    nozzleTarget: num(r.nozzle_target_temper),
    bed: num(r.bed_temper),
    bedTarget: num(r.bed_target_temper),
    chamber: model && NO_CHAMBER.test(model) ? undefined : num(r.chamber_temper),
  };
  const temperatures = Object.fromEntries(Object.entries(t).filter(([, v]) => v != null));
  const busy = isRunning(r) || isEnd(r);
  const remaining = nonNegative(r.mc_remaining_time);
  const progress = num(r.mc_percent);
  const jobPart = busy
    ? {
        // The cloud's task id: the same print in the Bambu Cloud source.
        ...(task && { id: task, peerId: task }),
        ...(text(r.gcode_file) && { file: String(r.gcode_file) }),
        ...(text(r.subtask_name) && { title: String(r.subtask_name) }),
        ...(start?.plate && { plate: start.plate }),
        ...(startedAt && { startedAt }),
        ...(progress != null && progress >= 0 && progress <= 100 && { progress }),
        ...(remaining != null && { etaSec: remaining * 60 }),
        ...(nonNegative(r.layer_num) != null && { layer: nonNegative(r.layer_num) }),
        ...(total && { totalLayers: total }),
        ...(start?.mapping && { slots: start.mapping.filter(used) }),
        ...(failureReason && { failureReason }),
        ...(job.totals?.length && { totals: job.totals }),
      }
    : undefined;
  return {
    printerExternalId: serial,
    at,
    state,
    ...(jobPart && Object.keys(jobPart).length && { job: jobPart }),
    ...(Object.keys(temperatures).length && { temperatures }),
    slots: slotsOf(r),
    // The trays as they are, also when idle; until the report has them, nothing is known.
    ...(("ams" in r || "vt_tray" in r) && { physicalSlots: true }),
  };
}
