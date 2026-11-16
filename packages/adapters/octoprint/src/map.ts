import type { JobTotal } from "@3d-maker-suite/3mf";
import type { PrinterSnapshot } from "@3d-maker-suite/core";
import { z } from "zod";

// OctoPrint's push messages (`current`, `event`) and what they become. Pure: no sockets here
// (index.ts opens them). Only the fields the app reads are described.
// Payloads: packages/adapters/octoprint/fixtures (OctoPrint 1.11.8, virtual printer).

/** One OctoPrint is one printer. Constant, so a changed address is still the same printer. */
export const PRINTER_ID = "octoprint";

const num = z.number().nullish();
const flag = z.boolean().optional();
const temp = z.object({ actual: num, target: num }).nullish();

const fileSchema = z.object({
  name: z.string().nullish(),
  path: z.string().nullish(),
  display: z.string().nullish(),
  origin: z.string().nullish(),
  size: num,
});

/** `current` (and the first `history`): the whole picture, sent every few seconds. */
export const currentSchema = z.object({
  state: z.object({
    text: z.string().nullish(),
    error: z.string().nullish(),
    flags: z.object({
      operational: flag,
      printing: flag,
      paused: flag,
      pausing: flag,
      resuming: flag,
      cancelling: flag,
      finishing: flag,
      error: flag,
      closedOrError: flag,
    }),
  }),
  job: z.object({ file: fileSchema.nullish() }).nullish(),
  progress: z.object({ completion: num, printTime: num, printTimeLeft: num }).nullish(),
  /** Only the readings since the last message: often empty. */
  temps: z.array(z.object({ tool0: temp, bed: temp, chamber: temp })).nullish(),
});
export type Current = z.infer<typeof currentSchema>;

const eventSchema = z.object({
  type: z.string(),
  payload: z
    .object({
      name: z.string().nullish(),
      path: z.string().nullish(),
      origin: z.string().nullish(),
      size: num,
      /** Seconds the print ran. */
      time: num,
      progress: num,
      reason: z.string().nullish(),
    })
    .nullish(),
});

const messageSchema = z.object({
  current: currentSchema.optional(),
  history: currentSchema.optional(),
  event: eventSchema.optional(),
});

/** Where a job file can be downloaded from. SD-card files (`origin: "sdcard"`) can't be. */
export interface FileRef {
  origin: string;
  path: string;
  size?: number;
}

/** A snapshot, and the file whose slicer totals it still wants. */
export interface Item {
  snap: PrinterSnapshot;
  file?: FileRef;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const seconds = (n: number | null | undefined) => (n != null && n >= 0 ? Math.round(n) : undefined);

type State = PrinterSnapshot["state"];

function stateOf(c: Current): State {
  const f = c.state.flags;
  if (f.error) return "error";
  // Cancelling and finishing still hold the job: PrintCancelled / PrintDone end it.
  if (f.printing || f.pausing || f.resuming || f.cancelling || f.finishing) return "printing";
  if (f.paused) return "paused";
  return f.operational ? "idle" : "offline";
}

/**
 * What the push says, kept between reads. A read gets the end events that happened since the last
 * one (each is an end state, `finished` · `cancelled` · `error`, as the tracker needs it), then the
 * printer as it is now.
 */
export function createModel() {
  let cur: Current | undefined;
  let temperatures: PrinterSnapshot["temperatures"] = {};
  let queue: Item[] = [];
  /** A print ended and no new one has started: the state may still say Finishing. */
  let ended = false;
  /** The file of the print that started last (the end events name it too). */
  let started: FileRef | undefined;
  let startedName: string | undefined;
  /** A print started and no `current` has said so yet: the last one is from before it. */
  let fresh = false;

  const refOf = (f: z.infer<typeof fileSchema> | null | undefined): FileRef | undefined => {
    const path = f?.path || f?.name;
    return path
      ? { origin: f?.origin || "local", path, ...(f?.size != null && { size: f.size }) }
      : undefined;
  };
  const nameOf = (f: z.infer<typeof fileSchema> | null | undefined) =>
    f?.display || f?.name || f?.path || undefined;

  function take(c: Current) {
    cur = c;
    fresh = false;
    const t = c.temps?.at(-1);
    if (!t) return;
    temperatures = {
      ...temperatures,
      ...(t.tool0?.actual != null && { nozzle: t.tool0.actual }),
      ...(t.tool0?.target != null && { nozzleTarget: t.tool0.target }),
      ...(t.bed?.actual != null && { bed: t.bed.actual }),
      ...(t.bed?.target != null && { bedTarget: t.bed.target }),
      ...(t.chamber?.actual != null && { chamber: t.chamber.actual }),
    };
  }

  function onEvent(e: z.infer<typeof eventSchema>, at: string) {
    const p = e.payload ?? {};
    const file =
      p.path || p.name
        ? { origin: p.origin || "local", path: (p.path || p.name) as string, size: p.size }
        : undefined;
    const ref: FileRef | undefined = file && {
      origin: file.origin,
      path: file.path,
      ...(file.size != null && { size: file.size }),
    };
    const name = p.name || p.path || undefined;
    const end = (state: State, job: NonNullable<PrinterSnapshot["job"]>) => {
      ended = true;
      queue.push({
        snap: { printerExternalId: PRINTER_ID, at, state, job, slots: [] },
        file: ref ?? started,
      });
    };
    switch (e.type) {
      case "PrintStarted":
        ended = false;
        fresh = true;
        started = ref;
        startedName = name;
        queue.push({
          snap: {
            printerExternalId: PRINTER_ID,
            at,
            state: "printing",
            job: { ...(name && { file: name }), progress: 0, elapsedSec: 0 },
            slots: [{ slot: 0, active: true }],
          },
          file: ref,
        });
        return;
      case "PrintDone":
        end("finished", {
          ...(name && { file: name }),
          ...(seconds(p.time) != null && { elapsedSec: seconds(p.time) }),
        });
        return;
      case "PrintCancelled":
        end("cancelled", {
          ...(name && { file: name }),
          ...(p.progress != null && { progress: round2(Math.min(100, Math.max(0, p.progress))) }),
          ...(seconds(p.time) != null && { elapsedSec: seconds(p.time) }),
        });
        return;
      case "PrintFailed":
        // A cancel raises PrintCancelled and then this, with reason "cancelled": one print.
        if (p.reason === "cancelled") return;
        end("error", {
          ...(name && { file: name }),
          ...(seconds(p.time) != null && { elapsedSec: seconds(p.time) }),
          failureReason: p.reason || cur?.state.error || "error",
        });
    }
  }

  return {
    /** One push message. false: a `current` this version doesn't understand. */
    push(raw: unknown, at: string): boolean {
      const m = messageSchema.safeParse(raw);
      if (!m.success) {
        const o = raw as { current?: unknown; history?: unknown } | null;
        return !(o?.current || o?.history);
      }
      const c = m.data.current ?? m.data.history;
      if (c) take(c);
      if (m.data.event) onEvent(m.data.event, at);
      return true;
    },
    /** The socket closed: nothing is known of the printer until it answers again. */
    disconnected() {
      cur = undefined;
    },
    /** The end events since the last read, then the printer now. */
    drain(at: string): Item[] {
      const out = queue;
      queue = [];
      out.push(live(at));
      return out;
    },
  };

  function live(at: string): Item {
    const snap: PrinterSnapshot = {
      printerExternalId: PRINTER_ID,
      at,
      state: "offline",
      slots: [],
    };
    if (!cur) return { snap };
    snap.temperatures = { ...temperatures };
    // The start is known before the next `current` says it: until then it's the print, at 0.
    if (fresh && stateOf(cur) === "idle") {
      snap.state = "printing";
      snap.job = { ...(startedName && { file: startedName }), progress: 0, elapsedSec: 0 };
      snap.slots = [{ slot: 0, active: true }];
      return { snap, file: started };
    }
    const state = ended && stateOf(cur) === "printing" ? "idle" : stateOf(cur);
    snap.state = state;
    if (state === "error" && !ended)
      snap.job = { failureReason: cur.state.error || cur.state.text || "error" };
    if (state !== "printing" && state !== "paused") return { snap };
    const f = cur.job?.file;
    const p = cur.progress;
    snap.job = {
      ...(nameOf(f) && { file: nameOf(f) }),
      ...(seconds(p?.printTime) != null && { elapsedSec: seconds(p?.printTime) }),
      ...(p?.completion != null && { progress: round2(Math.min(100, Math.max(0, p.completion))) }),
      ...(state === "printing" &&
        seconds(p?.printTimeLeft) != null && { etaSec: seconds(p?.printTimeLeft) }),
    };
    snap.slots = [{ slot: 0, active: true }];
    return { snap, file: refOf(f) };
  }
}

/**
 * The slicer's grams on a snapshot's job. The tools the file uses (a multi-tool file leaves the
 * others at 0 g), else the one the printer has.
 */
export function withTotals(snap: PrinterSnapshot, totals: JobTotal[] | undefined): PrinterSnapshot {
  if (!totals?.length || !snap.job) return snap;
  const used = totals.filter((t) => t.slot != null && t.grams > 0).map((t) => t.slot ?? 0);
  const out: PrinterSnapshot = {
    ...snap,
    job: { ...snap.job, totals: totals.map(({ slot, grams }) => ({ slot, grams })) },
  };
  if (used.length && out.job) {
    out.job.slots = used;
    if (snap.slots.length)
      out.slots = used.map((slot) => ({ slot, active: snap.slots[0]?.active ?? false }));
  }
  return out;
}
