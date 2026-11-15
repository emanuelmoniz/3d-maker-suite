import { describe, expect, it } from "vitest";
import { type PrinterSnapshot, printerSnapshotSchema } from "../schemas/integrations.ts";
import { type TrackedPrint, type TrackerState, track } from "./jobTracker.ts";

// Each sequence is what an adapter makes of a recorded one (Plan 6.0.0 Step 1, the `fixtures`
// folder of its adapter): the same states in the same order at the same times, and the same fields
// missing where the printer leaves them out. Reading the raw messages is the adapter's job.

type Snap = Omit<PrinterSnapshot, "printerExternalId" | "slots"> & {
  slots?: PrinterSnapshot["slots"];
};
const day = (time: string) => `2026-11-14T${time}Z`;

/** Runs the snapshots through the tracker, each one checked against the schema first. */
function run(snaps: Snap[], from: TrackerState = { phase: "unknown" }) {
  let state = from;
  const prints: TrackedPrint[] = [];
  for (const s of snaps) {
    const out = track(state, printerSnapshotSchema.parse({ printerExternalId: "p1", ...s }));
    state = out.state;
    prints.push(...out.prints);
  }
  return { state, prints };
}

describe("Bambu LAN (bambu/fixtures/lan)", () => {
  const ams = (active?: boolean) => [
    { slot: 0, material: "PLA", colorHex: "#F7D959", rfid: "AAAAAAA100000100", active },
    { slot: 1, material: "PLA", colorHex: "#F7CED7", rfid: "AAAAAAA200000100" },
  ];
  // The cloud's start command, echoed on the LAN: task id, plate, AMS mapping, start to the second.
  const started = (id: string, startedAt: string) => ({
    id,
    peerId: id,
    file: "test-print.3mf",
    title: "test-print",
    plate: 3,
    startedAt,
    slots: [0],
  });

  it("print-1-finish: one finished print; the FINISH message has no file", () => {
    const job = started("100000001", day("11:25:04.000"));
    const { state, prints } = run([
      { at: day("11:25:00.000"), state: "idle", slots: ams() },
      { at: day("11:25:08.734"), state: "preparing", job, slots: ams() },
      {
        at: day("11:25:23.845"),
        state: "printing",
        job: { ...job, etaSec: 1140, totalLayers: 45 },
        slots: ams(),
      },
      {
        at: day("11:35:00.000"),
        state: "printing",
        job: { id: job.id, progress: 60, layer: 20, totalLayers: 45 },
        slots: ams(true),
      },
      // `gcode_file` is empty and the tray is unloaded (`tray_now` 255).
      {
        at: day("11:45:03.932"),
        state: "finished",
        job: { id: job.id, title: "test-print", progress: 100, layer: 45, totalLayers: 45 },
        slots: ams(),
      },
      { at: day("11:45:05.990"), state: "finished", job: { progress: 100 }, slots: ams() },
    ]);
    expect(state).toEqual({ phase: "idle" });
    expect(prints).toEqual([
      {
        print: {
          externalId: "100000001",
          peerId: "100000001",
          printerExternalId: "p1",
          title: "test-print",
          plate: 3,
          startedAt: day("11:25:04.000"),
          durationSec: 1200,
          outcome: "success",
          filaments: [{ slot: 0, material: "PLA", colorHex: "#F7D959", rfid: "AAAAAAA100000100" }],
        },
        partial: false,
        endSeen: true,
        job: { file: "test-print.3mf", progress: 100, layer: 45, totalLayers: 45 },
      },
    ]);
  });

  it("print-2-failed: a cancel is one cancelled print, with the layer it reached", () => {
    const job = started("100000005", day("11:49:26.000"));
    const { prints } = run([
      { at: day("11:49:00.000"), state: "finished", slots: ams() },
      { at: day("11:49:30.429"), state: "preparing", job, slots: ams() },
      { at: day("11:49:39.264"), state: "printing", job: { ...job, progress: 0 }, slots: ams() },
      {
        at: day("11:55:52.206"),
        state: "printing",
        job: { id: job.id, progress: 40, layer: 6, totalLayers: 45, etaSec: 660 },
        slots: ams(true),
      },
      // FAILED with `print_error` 0x0300400C: the adapter reads it as a cancel.
      {
        at: day("11:55:55.498"),
        state: "cancelled",
        job: { id: job.id, progress: 40, layer: 6, totalLayers: 45 },
        slots: ams(true),
      },
      // Four seconds later the percent is back to 0, still FAILED.
      { at: day("11:55:59.594"), state: "cancelled", job: { progress: 0 }, slots: ams() },
    ]);
    expect(prints).toHaveLength(1);
    expect(prints[0]).toMatchObject({
      print: {
        externalId: "100000005",
        startedAt: day("11:49:26.000"),
        durationSec: 389,
        outcome: "cancelled",
        filaments: [{ slot: 0, rfid: "AAAAAAA100000100" }],
      },
      partial: false,
      endSeen: true,
      job: { file: "test-print.3mf", progress: 40, layer: 6, totalLayers: 45 },
    });
  });
});

describe("Moonraker (moonraker/fixtures/ws-sequence.json, status-error.json)", () => {
  const tool = (gramsUsed?: number) => [
    { slot: 0, material: "PLA", colorHex: "#F2754E", spoolId: "3", active: true, gramsUsed },
  ];

  it("a cancelled and a completed job: two prints, the cancelled one with what it really used", () => {
    const { prints } = run([
      { at: day("10:54:31.726"), state: "idle", slots: tool() },
      {
        at: day("10:54:34.981"),
        state: "printing",
        job: { file: "cube_orca.gcode", elapsedSec: 0, progress: 0.6 },
        slots: tool(0),
      },
      // The history job arrives right after: its id.
      {
        at: day("11:00:07.046"),
        state: "printing",
        job: { id: "000002", file: "cube_orca.gcode", elapsedSec: 332, progress: 16 },
        slots: tool(0.22),
      },
      // After a cancel `virtual_sdcard` is reset: no file, progress 0.
      {
        at: day("11:00:10.303"),
        state: "cancelled",
        job: { id: "000002", elapsedSec: 335, progress: 0 },
        slots: tool(0.23),
      },
      {
        at: day("11:00:36.619"),
        state: "cancelled",
        job: { file: "cube_orca.gcode", elapsedSec: 335 },
        slots: tool(0.23),
      },
      {
        at: day("11:00:40.125"),
        state: "printing",
        job: { file: "tile_orca.gcode", elapsedSec: 0, progress: 1.5 },
        slots: tool(0),
      },
      {
        at: day("11:03:33.058"),
        state: "finished",
        job: { id: "000003", elapsedSec: 173, progress: 100 },
        slots: tool(0.07),
      },
    ]);
    expect(prints.map((p) => p.print)).toEqual([
      {
        externalId: "000002",
        printerExternalId: "p1",
        title: "cube_orca",
        startedAt: day("10:54:34.981"),
        durationSec: 335,
        outcome: "cancelled",
        filaments: [{ slot: 0, material: "PLA", colorHex: "#F2754E", spoolId: "3", grams: 0.23 }],
      },
      {
        externalId: "000003",
        printerExternalId: "p1",
        title: "tile_orca",
        startedAt: day("11:00:40.125"),
        durationSec: 173,
        outcome: "success",
        filaments: [{ slot: 0, material: "PLA", colorHex: "#F2754E", spoolId: "3", grams: 0.07 }],
      },
    ]);
    // The reset at the cancel doesn't take back how far it got.
    expect(prints[0]?.job).toEqual({ file: "cube_orca.gcode", progress: 16 });
  });

  it("a job that ends in error is a failed print with the printer's reason", () => {
    const { prints } = run([
      { at: day("02:49:51.000"), state: "idle" },
      { at: day("02:49:51.100"), state: "printing", job: { file: "cube_orca.gcode" } },
      {
        at: day("02:49:51.136"),
        state: "error",
        job: {
          file: "cube_orca.gcode",
          elapsedSec: 0,
          failureReason: "Must home axis first: 158.814 158.814 0.000 [-0.800]",
        },
      },
    ]);
    expect(prints.map((p) => p.print)).toMatchObject([
      { outcome: "failed", failureReason: "Must home axis first: 158.814 158.814 0.000 [-0.800]" },
    ]);
  });
});

describe("OctoPrint (octoprint/fixtures/push-sequence.json)", () => {
  it("a finished print, then a cancel that raises two end events: two prints", () => {
    const job = { file: "cube_marlin.gcode" };
    const { state, prints } = run([
      { at: day("02:50:31.877"), state: "idle" },
      { at: day("02:50:33.877"), state: "printing", job: { ...job, progress: 1, elapsedSec: 0 } },
      // PrintDone.
      { at: day("02:51:08.902"), state: "finished", job: { ...job, elapsedSec: 37 } },
      // The next print starts before the state is Operational again.
      { at: day("02:51:11.887"), state: "printing", job: { ...job, progress: 7, elapsedSec: 1 } },
      // PrintCancelled, then PrintFailed with `reason: "cancelled"` 14 ms later.
      {
        at: day("02:51:20.761"),
        state: "cancelled",
        job: { ...job, progress: 47, elapsedSec: 10 },
      },
      { at: day("02:51:20.775"), state: "error", job: { ...job, failureReason: "cancelled" } },
      { at: day("02:51:21.888"), state: "idle" },
    ]);
    expect(state).toEqual({ phase: "idle" });
    expect(prints.map((p) => [p.print.outcome, p.print.startedAt, p.print.durationSec])).toEqual([
      ["success", day("02:50:33.877"), 37],
      ["cancelled", day("02:51:10.887"), 10],
    ]);
    // No id from the printer: the start tells two prints of one file apart.
    expect(prints.map((p) => p.print.externalId)).toEqual([
      day("02:50:33.877"),
      day("02:51:10.887"),
    ]);
    expect(prints[1]?.print.failureReason).toBeUndefined();
  });
});

describe("PrusaLink (prusalink/fixtures/status-printing.json, job-printing.json)", () => {
  // No history and no push: the fixture is a print first seen at 37%, 12 hours in.
  const seen: Snap = {
    at: day("12:13:07.000"),
    state: "printing",
    job: { id: "129", file: "/usb/TabletStand3~4.BGC", title: "TabletStand3", progress: 37 },
    slots: [{ slot: 0, material: "PLA", active: true }],
  };
  const withTime = { ...seen, job: { ...seen.job, elapsedSec: 43987, etaSec: 73020 } };

  it("a print first seen half-way is partial; its start comes from the printer's own clock", () => {
    const { prints } = run([
      withTime,
      { at: day("12:20:00.000"), state: "finished", job: { id: "129", elapsedSec: 44400 } },
    ]);
    expect(prints).toMatchObject([
      {
        print: {
          externalId: "129",
          title: "TabletStand3",
          startedAt: day("00:00:00.000"),
          durationSec: 44400,
          outcome: "success",
          filaments: [{ slot: 0, material: "PLA" }],
        },
        partial: true,
        endSeen: true,
      },
    ]);
  });

  it("without the printer's clock the start is when it was first seen", () => {
    const { prints } = run([seen, { at: day("12:20:00.000"), state: "finished" }]);
    expect(prints).toMatchObject([
      { print: { startedAt: day("12:13:07.000"), durationSec: 413 }, partial: true },
    ]);
  });

  it("the job is gone with no end state (HTTP 204): recorded, the end not seen", () => {
    const gone = run([withTime, { at: day("12:20:00.000"), state: "idle" }]);
    expect(gone.prints).toMatchObject([{ print: { outcome: "failed" }, endSeen: false }]);
    const done = run([
      { ...withTime, job: { ...withTime.job, progress: 100 } },
      { at: day("12:20:00.000"), state: "idle" },
    ]);
    expect(done.prints).toMatchObject([{ print: { outcome: "success" }, endSeen: false }]);
  });
});

describe("the tracker's states", () => {
  const job = { id: "7", file: "a.gcode" };
  const printing = (time: string, progress: number): Snap => ({
    at: day(time),
    state: "printing",
    job: { ...job, progress },
  });

  it("an end state nobody watched is an old job: nothing is recorded", () => {
    for (const state of ["finished", "cancelled", "error"] as const) {
      const out = run([{ at: day("10:00:00.000"), state, job }]);
      expect(out).toEqual({ state: { phase: "idle" }, prints: [] });
      expect(run([{ at: day("10:01:00.000"), state: "idle" }], out.state).prints).toEqual([]);
      // Nor one that shows up between two reads of an idle printer.
      const missed = run([
        { at: day("10:00:00.000"), state: "idle" },
        { at: day("10:00:05.000"), state, job },
      ]);
      expect(missed).toEqual({ state: { phase: "idle" }, prints: [] });
    }
  });

  it("a restart during a print: the stored state carries the job on", () => {
    const before = run([
      { at: day("10:00:00.000"), state: "idle" },
      { at: day("10:00:10.000"), state: "preparing", job },
      printing("10:05:00.000", 20),
    ]);
    expect(before.prints).toEqual([]);
    // What the server keeps is plain JSON.
    const stored: TrackerState = JSON.parse(JSON.stringify(before.state));
    const after = run(
      [printing("10:20:00.000", 80), { at: day("10:30:00.000"), state: "finished" }],
      stored,
    );
    expect(after.prints).toMatchObject([
      {
        print: { externalId: "7", startedAt: day("10:00:10.000"), durationSec: 1790 },
        partial: false,
        endSeen: true,
      },
    ]);
    // Without it, the same print is one first seen half-way.
    const fresh = run([
      printing("10:20:00.000", 80),
      { at: day("10:30:00.000"), state: "finished" },
    ]);
    expect(fresh.prints).toMatchObject([
      { print: { startedAt: day("10:20:00.000") }, partial: true },
    ]);
  });

  it("a restart that slept through the end: the stored job ends as the printer shows it", () => {
    const before = run([{ at: day("10:00:00.000"), state: "idle" }, printing("10:05:00.000", 20)]);
    const after = run([{ at: day("12:00:00.000"), state: "cancelled", job }], before.state);
    expect(after.prints).toMatchObject([{ print: { outcome: "cancelled" }, endSeen: true }]);
    // Another job's end: the stored one is gone, and the other was never watched.
    const other = run(
      [{ at: day("12:00:00.000"), state: "finished", job: { id: "8" } }],
      before.state,
    );
    expect(other.prints).toMatchObject([
      { print: { externalId: "7", outcome: "failed", durationSec: 0 }, endSeen: false },
    ]);
    expect(other.state).toEqual({ phase: "idle" });
  });

  it("offline during a print keeps the job; offline while idle stops watching", () => {
    const { prints } = run([
      { at: day("10:00:00.000"), state: "idle" },
      printing("10:00:10.000", 1),
      { at: day("10:10:00.000"), state: "offline" },
      { at: day("10:10:10.000"), state: "offline" },
      printing("10:20:00.000", 60),
      { at: day("10:30:00.000"), state: "finished" },
    ]);
    expect(prints).toMatchObject([{ print: { durationSec: 1790 }, partial: false }]);
    // The printer was out of sight when this one started.
    const unseen = run([
      { at: day("10:00:00.000"), state: "idle" },
      { at: day("10:01:00.000"), state: "offline" },
      printing("10:20:00.000", 60),
      { at: day("10:30:00.000"), state: "finished" },
    ]);
    expect(unseen.prints).toMatchObject([{ partial: true }]);
  });

  it("another job while one is active: the first is closed, its end not seen", () => {
    const { state, prints } = run([
      { at: day("10:00:00.000"), state: "idle" },
      printing("10:00:10.000", 1),
      printing("10:10:00.000", 50),
      { at: day("10:30:00.000"), state: "printing", job: { id: "8", file: "a.gcode" } },
    ]);
    expect(prints).toMatchObject([
      { print: { externalId: "7", outcome: "failed", durationSec: 590 }, endSeen: false },
    ]);
    expect(state).toMatchObject({ phase: "active", job: { id: "8", partial: true } });
  });

  it("one job unless both snapshots name an id, or both a file, and they differ", () => {
    const { prints } = run([
      { at: day("10:00:00.000"), state: "idle" },
      { at: day("10:00:10.000"), state: "printing", job: { file: "a.gcode" } },
      { at: day("10:01:00.000"), state: "printing", job: { id: "7" } },
      { at: day("10:02:00.000"), state: "paused", job: { id: "7", file: "a.gcode" } },
      { at: day("10:03:00.000"), state: "printing" },
      { at: day("10:04:00.000"), state: "printing", job: { file: "b.gcode" } },
    ]);
    expect(prints.map((p) => p.print.externalId)).toEqual(["7"]);
  });

  it("slots: the printer's plan, else every slot seen feeding; a planned slot it never showed", () => {
    const slots = (active: number) =>
      [0, 1, 2].map((slot) => ({ slot, material: `M${slot}`, active: slot === active }));
    const fed = run([
      { at: day("10:00:00.000"), state: "idle", slots: slots(-1) },
      { at: day("10:00:10.000"), state: "printing", job, slots: slots(2) },
      { at: day("10:10:00.000"), state: "printing", job, slots: slots(0) },
      { at: day("10:30:00.000"), state: "finished", job, slots: slots(-1) },
    ]);
    expect(fed.prints[0]?.print.filaments).toEqual([
      { slot: 0, material: "M0" },
      { slot: 2, material: "M2" },
    ]);
    const planned = run([
      { at: day("10:00:00.000"), state: "idle", slots: slots(-1) },
      {
        at: day("10:00:10.000"),
        state: "printing",
        job: { ...job, slots: [1, 5] },
        slots: slots(2),
      },
      { at: day("10:30:00.000"), state: "finished", job, slots: slots(-1) },
    ]);
    expect(planned.prints[0]?.print.filaments).toEqual([{ slot: 1, material: "M1" }, { slot: 5 }]);
  });

  it("a print with no title is named after its file, else after its id or start", () => {
    const title = (j: NonNullable<Snap["job"]>) =>
      run([
        { at: day("10:00:00.000"), state: "idle" },
        { at: day("10:00:10.000"), state: "printing", job: j },
        { at: day("10:30:00.000"), state: "finished" },
      ]).prints[0]?.print.title;
    expect(title({ file: "/usb/Tablet Stand.gcode.3mf" })).toBe("Tablet Stand");
    expect(title({ file: "C:\\jobs\\benchy.bgcode" })).toBe("benchy");
    expect(title({ id: "42" })).toBe("42");
    expect(title({})).toBe(day("10:00:10.000"));
  });
});
