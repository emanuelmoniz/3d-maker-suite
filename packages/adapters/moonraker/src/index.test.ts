import { readFileSync } from "node:fs";
import {
  type IntegrationInstance,
  type PrinterSnapshot,
  printerSnapshotSchema,
  type TrackerState,
  track,
} from "@3d-maker-suite/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { baseUrl, moonrakerAdapter } from "./index.ts";

// The Step 1 fixtures (fixtures/SOURCE.md), served by a fake `fetch`: each test says what every
// path answers, as Moonraker answered it.

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));

/** The newest history job, as Moonraker shows it while that job runs. */
function inProgress(history: string) {
  const h = load(history);
  const job = { ...h.result.jobs[0], status: "in_progress" };
  return { result: { count: h.result.count, jobs: [job] } };
}

type Answer = unknown | ((url: URL) => unknown);
let routes: Record<string, Answer>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routes = {};
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    expect(url.origin).toBe("http://voron.local:7125");
    const answer = routes[url.pathname];
    if (answer === undefined) return new Response("not found", { status: 404 });
    const body = typeof answer === "function" ? answer(url) : answer;
    if (body instanceof Response) return body;
    if (body instanceof Error) throw body;
    return Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The Spoolman spool a job names, which Moonraker charged itself. */
const spoolman = (id: number) => ({ spoolId: `spoolman:${id}`, chargedAtSource: true });

const silent = { debug() {}, info() {}, warn() {}, error() {} };
function instance(config: Record<string, unknown> = {}, apiKey?: string): IntegrationInstance {
  const adapter = moonrakerAdapter();
  const create = adapter.create;
  if (!create) throw new Error("no create");
  return create({
    config: adapter.configSchema.parse({ host: "voron.local:7125", ...config }),
    secrets: {
      get: async (k) => (k === "apiKey" ? apiKey : undefined),
      set: async () => {},
      delete: async () => {},
    },
    log: silent,
    signal: new AbortController().signal,
  });
}

/** Reads the status once per step, each step with its own answers, through the job tracker. */
async function watch(src: IntegrationInstance, steps: Record<string, Answer>[]) {
  let state: TrackerState = { phase: "idle" };
  const snaps: PrinterSnapshot[] = [];
  const prints = [];
  for (const step of steps) {
    Object.assign(routes, step);
    const [snap] = (await src.status?.readStatus()) ?? [];
    const parsed = printerSnapshotSchema.parse(snap);
    snaps.push(parsed);
    const out = track(state, parsed);
    state = out.state;
    prints.push(...out.prints);
  }
  return { snaps, prints };
}

it("adds http:// to a bare host and drops a trailing slash", () => {
  expect(baseUrl("192.168.1.50")).toBe("http://192.168.1.50");
  expect(baseUrl("https://voron.example/")).toBe("https://voron.example");
});

it("imports the three history jobs as their prints, the cancelled one with 0.23 of 0.99 g", async () => {
  routes["/server/history/list"] = load("history-list-after-complete");
  const page = await instance().printHistory?.listPrints({});
  expect(page?.nextCursor).toBeUndefined();
  const filament = { slot: 0, material: "PLA", colorHex: "#F2754E" };
  expect(page?.items).toEqual([
    {
      externalId: "000003",
      printerExternalId: "klipper",
      title: "tile_orca",
      startedAt: "2026-11-14T11:00:40.125Z",
      durationSec: 173,
      outcome: "success",
      filaments: [{ ...filament, grams: 0.07, ...spoolman(3) }],
    },
    {
      externalId: "000002",
      printerExternalId: "klipper",
      title: "cube_orca",
      startedAt: "2026-11-14T10:54:34.981Z",
      durationSec: 335,
      outcome: "cancelled",
      // 76.50 of 331.1 mm extruded: measured, so not estimated.
      filaments: [{ ...filament, grams: 0.23, ...spoolman(3) }],
    },
    {
      externalId: "000001",
      printerExternalId: "klipper",
      title: "cube_orca",
      startedAt: "2026-11-14T02:49:51.128Z",
      durationSec: 0,
      outcome: "failed",
      filaments: [{ ...filament, grams: 0, ...spoolman(1) }],
    },
  ]);
});

it("a Moonraker that reports to another Spoolman names no spool and charged none of the app's", async () => {
  routes["/server/history/list"] = load("history-list-after-complete");
  const page = await instance({ otherSpoolman: true }).printHistory?.listPrints({});
  expect(page?.items[0]?.filaments).toEqual([
    { slot: 0, material: "PLA", colorHex: "#F2754E", grams: 0.07 },
  ]);
});

it("a job that names no Spoolman spool wasn't reported to one", async () => {
  const h = load("history-list-after-complete");
  for (const job of h.result.jobs) job.auxiliary_data = [];
  routes["/server/history/list"] = h;
  const page = await instance().printHistory?.listPrints({});
  expect(page?.items[0]?.filaments).toEqual([
    { slot: 0, material: "PLA", colorHex: "#F2754E", grams: 0.07 },
  ]);
});

it("pages the history and passes the range in Unix seconds", async () => {
  const all = load("history-list-after-complete");
  routes["/server/history/list"] = (url: URL) => {
    const start = Number(url.searchParams.get("start"));
    return { result: { count: 3, jobs: all.result.jobs.slice(start, start + 2) } };
  };
  const src = instance();
  const first = await src.printHistory?.listPrints({
    since: "2026-11-14T00:00:00.000Z",
    until: "2026-11-15T00:00:00.000Z",
  });
  const q = new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams;
  expect(q.get("since")).toBe(String(Date.UTC(2026, 10, 14) / 1000));
  expect(q.get("before")).toBe(String(Date.UTC(2026, 10, 15) / 1000));
  expect(q.get("order")).toBe("desc");
  expect(first?.items).toHaveLength(2);
  // Two jobs per page here, whatever the adapter asked for.
  routes["/server/history/list"] = (url: URL) => {
    const start = Number(url.searchParams.get("start"));
    expect(start).toBe(2);
    return { result: { count: 3, jobs: all.result.jobs.slice(start) } };
  };
  const second = await src.printHistory?.listPrints({ cursor: first?.nextCursor });
  expect(second?.items.map((p) => p.externalId)).toEqual(["000001"]);
  expect(second?.nextCursor).toBeUndefined();
});

it("leaves the job in progress out of the history", async () => {
  routes["/server/history/list"] = inProgress("history-list-after-cancelled");
  expect((await instance().printHistory?.listPrints({}))?.items).toEqual([]);
});

it("a multi-tool job splits the length really extruded over its tools, estimated", async () => {
  const h = load("history-list-after-cancelled");
  const job = h.result.jobs[0];
  job.metadata = {
    ...job.metadata,
    filament_type: "PLA;PETG;PLA",
    filament_colors: ["#F2754E", "#000000", "#FFFFFF"],
    filament_weights: [0.66, 0.33, 0],
  };
  routes["/server/history/list"] = h;
  const [print] = (await instance().printHistory?.listPrints({}))?.items ?? [];
  // Moonraker charged its Spoolman spool for both tools; which spool each used is unsure.
  const est = { gramsEstimated: true, chargedAtSource: true };
  expect(print?.filaments).toEqual([
    { slot: 0, material: "PLA", colorHex: "#F2754E", grams: 0.15, ...est },
    { slot: 1, material: "PETG", colorHex: "#000000", grams: 0.08, ...est },
  ]);
});

it("the cancelled job, watched live, is one print with the grams really extruded", async () => {
  const src = instance();
  const { snaps, prints } = await watch(src, [
    {
      "/printer/objects/query": load("status-printing-cube_orca"),
      "/server/history/list": inProgress("history-list-after-cancelled"),
      "/server/spoolman/spool_id": load("spoolman-spool-id"),
    },
    {
      "/printer/objects/query": load("status-cancelled"),
      "/server/history/list": load("history-list-after-cancelled"),
    },
    { "/printer/objects/query": load("status-idle") },
  ]);
  expect(snaps[0]).toMatchObject({
    state: "printing",
    job: {
      id: "000002",
      file: "cube_orca.gcode",
      startedAt: "2026-11-14T10:54:34.981Z",
      elapsedSec: 335,
      progress: 15.78,
      // Klipper has no layer numbers here: from Z (0.6 mm) and the file's 0.2 mm layers.
      layer: 3,
      totalLayers: 15,
      slots: [0],
    },
    temperatures: { nozzle: 103.26, nozzleTarget: 0, bed: 103.26, bedTarget: 0 },
    slots: [
      {
        slot: 0,
        material: "PLA",
        colorHex: "#F2754E",
        ...spoolman(3),
        active: true,
        gramsUsed: 0.23,
      },
    ],
  });
  expect(snaps[0]?.job?.etaSec).toBeGreaterThan(0);
  expect(snaps[1]?.state).toBe("cancelled");
  // The job was read once; the end and the idle printer after it ask nothing more than the status.
  const paths = fetchMock.mock.calls.map((c) => new URL(c[0] as string).pathname);
  expect(paths.filter((p) => p === "/server/history/list")).toHaveLength(1);
  expect(prints).toHaveLength(1);
  expect(prints[0]?.print).toMatchObject({
    externalId: "000002",
    title: "cube_orca",
    outcome: "cancelled",
    filaments: [{ slot: 0, material: "PLA", colorHex: "#F2754E", ...spoolman(3), grams: 0.23 }],
  });
  expect(prints[0]?.endSeen).toBe(true);
});

it("the completed job, watched live, is one finished print", async () => {
  const { prints } = await watch(instance(), [
    {
      "/printer/objects/query": load("status-printing-tile_orca"),
      "/server/history/list": inProgress("history-list-after-complete"),
    },
    {
      "/printer/objects/query": load("status-complete"),
      "/server/history/list": load("history-list-after-complete"),
    },
  ]);
  expect(prints).toHaveLength(1);
  expect(prints[0]?.print).toMatchObject({
    externalId: "000003",
    outcome: "success",
    filaments: [{ slot: 0, material: "PLA", grams: 0.07 }],
  });
});

it("a job the history doesn't have yet gets its id on a later read", async () => {
  const src = instance();
  const { snaps } = await watch(src, [
    {
      "/printer/objects/query": load("status-printing-cube_orca"),
      // The cube's previous job: finished, so not this one.
      "/server/history/list": load("history-list-after-cancelled"),
      "/server/files/metadata": load("metadata-cube_orca"),
    },
    { "/server/history/list": inProgress("history-list-after-cancelled") },
  ]);
  expect(snaps[0]?.job?.id).toBeUndefined();
  expect(snaps[0]?.job?.totalLayers).toBe(15);
  expect(snaps[1]?.job?.id).toBe("000002");
});

it("an error says why in Klipper's words", async () => {
  routes["/printer/objects/query"] = load("status-error");
  const [snap] = (await instance().status?.readStatus()) ?? [];
  expect(snap).toMatchObject({
    state: "error",
    job: {
      file: "cube_orca.gcode",
      failureReason: "Must home axis first: 158.814 158.814 0.000 [-0.800]",
    },
  });
});

it("an idle printer has no job", async () => {
  routes["/printer/objects/query"] = load("ws-sequence")[0].msg;
  const [snap] = (await instance().status?.readStatus()) ?? [];
  expect(snap).toMatchObject({ state: "idle", slots: [] });
  expect(snap?.job).toBeUndefined();
});

it("a printer that doesn't answer is offline; a refused key throws", async () => {
  routes["/printer/objects/query"] = () => new TypeError("fetch failed");
  expect((await instance().status?.readStatus())?.[0]?.state).toBe("offline");
  routes["/printer/objects/query"] = () => new Response("", { status: 503 });
  expect((await instance().status?.readStatus())?.[0]?.state).toBe("offline");
  routes["/printer/objects/query"] = () => new Response("", { status: 401 });
  await expect(instance().status?.readStatus()).rejects.toMatchObject({ code: "auth_required" });
});

it("test: ok, a wrong key, or nothing there", async () => {
  routes["/server/info"] = load("server-info");
  expect(await instance({}, "key").test()).toEqual({ ok: true });
  const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers);
  expect(headers.get("x-api-key")).toBe("key");
  routes["/server/info"] = () => new Response("", { status: 401 });
  expect(await instance().test()).toEqual({ ok: false, code: "auth_required" });
  routes["/server/info"] = () => new TypeError("fetch failed");
  expect(await instance().test()).toEqual({ ok: false, code: "unreachable" });
});

it("lists the printer: its name from Klipper, its model from the newest job", async () => {
  routes["/printer/info"] = load("printer-info");
  routes["/server/history/list"] = load("history-list-after-complete");
  expect(await instance().printers?.listPrinters()).toEqual([
    { externalId: "klipper", name: "25533e3d5d25", brand: "Klipper", model: "Voron 2.4 300" },
  ]);
  const named = instance({ brand: "Voron", model: "2.4 350" });
  expect(await named.printers?.listPrinters()).toEqual([
    { externalId: "klipper", name: "25533e3d5d25", brand: "Voron", model: "2.4 350" },
  ]);
});
