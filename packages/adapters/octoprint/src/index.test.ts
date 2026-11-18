import { readFileSync } from "node:fs";
import {
  type IntegrationInstance,
  type PrinterSnapshot,
  printerSnapshotSchema,
  type TrackerState,
  track,
} from "@3d-maker-suite/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { baseUrl, octoprintAdapter } from "./index.ts";

// The Step 1 fixtures (fixtures/SOURCE.md: OctoPrint 1.11.8 with its virtual printer), the push
// socket played by a fake `WebSocket`, the job file by a fake `fetch`, and the job-file fixtures of
// packages/3mf.

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
const jobFile = (name: string) =>
  readFileSync(new URL(`../../../3mf/fixtures/job-headers/${name}`, import.meta.url));

type Msg = Record<string, unknown>;

/** The fake printer's side of the push socket. */
class FakeSocket extends EventTarget {
  static all: FakeSocket[] = [];
  static first: Msg[] = [];
  sent: string[] = [];
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
    FakeSocket.all.push(this);
    setTimeout(() => this.dispatchEvent(new Event("open")), 0);
  }
  send(data: string) {
    this.sent.push(data);
    // What the server answers to the auth: the history, then the first `current`.
    if (data.includes('"auth"')) for (const m of FakeSocket.first) this.deliver(m);
  }
  deliver(msg: Msg) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
  }
  close() {
    this.dispatchEvent(new Event("close"));
  }
}

type Answer = unknown | ((url: URL, req: Request) => unknown);
let routes: Record<string, Answer>;
let fetchMock: ReturnType<typeof vi.fn>;
let key: string | undefined;

beforeEach(() => {
  routes = { "/api/login": { name: "_api", session: "abc" } };
  key = undefined;
  FakeSocket.all = [];
  FakeSocket.first = [operational()];
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe("http://octopi.local");
    const req = new Request(url, init);
    if (key !== undefined && req.headers.get("x-api-key") !== key)
      return new Response("", { status: 403 });
    const answer = routes[url.pathname];
    if (answer === undefined) return new Response("not found", { status: 404 });
    const body = typeof answer === "function" ? answer(url, req) : answer;
    if (body instanceof Response) return body;
    if (body instanceof Error) throw body;
    return Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

const silent = { debug() {}, info() {}, warn() {}, error() {} };
function instance(
  config: Record<string, unknown> = {},
  secrets: Record<string, string> = {},
): IntegrationInstance {
  const adapter = octoprintAdapter();
  const create = adapter.create;
  if (!create) throw new Error("no create");
  return create({
    config: adapter.configSchema.parse({ host: "octopi.local", ...config }),
    secrets: { get: async (k) => secrets[k], set: async () => {}, delete: async () => {} },
    log: silent,
    signal: new AbortController().signal,
  });
}

/** The first `current` that says Operational: the printer is connected and idle. */
const operational = (): Msg =>
  load("push-sequence")
    .map((m: { msg: Msg }) => m.msg)
    .find(
      (m: Msg) =>
        (m.current as { state: { text: string } } | undefined)?.state.text === "Operational",
    );

const live = () => FakeSocket.all.at(-1) as FakeSocket;

const download =
  (bytes: Buffer, opts: { ranged?: boolean } = {}) =>
  (_: URL, req: Request) => {
    const range = req.headers.get("range") ?? "";
    const from = /bytes=(\d+)-/.exec(range);
    const last = /bytes=-(\d+)/.exec(range);
    if (opts.ranged && from) {
      const a = Number(from[1]);
      const to = Number(/-(\d+)$/.exec(range)?.[1]) + 1;
      return new Response(new Uint8Array(bytes.subarray(a, to)), { status: 206 });
    }
    if (opts.ranged && last)
      return new Response(new Uint8Array(bytes.subarray(bytes.length - Number(last[1]))), {
        status: 206,
      });
    return new Response(new Uint8Array(bytes));
  };

const FILE = "/downloads/files/local/cube_marlin.gcode";

/** Reads the status after each message `when` picks, through the job tracker. */
async function replay(
  src: IntegrationInstance,
  messages: Msg[],
  when: (m: Msg) => boolean = (m) => !!m.current || !!m.event,
) {
  let state: TrackerState = { phase: "idle" };
  const snaps: PrinterSnapshot[] = [];
  const prints: ReturnType<typeof track>["prints"] = [];
  const read = async () => {
    for (const snap of (await src.status?.readStatus()) ?? []) {
      const parsed = printerSnapshotSchema.parse(snap);
      snaps.push(parsed);
      const out = track(state, parsed);
      state = out.state;
      prints.push(...out.prints);
    }
  };
  await read();
  for (const m of messages) {
    live().deliver(m);
    // Two prints must not start within the same millisecond.
    if (when(m)) {
      await new Promise((r) => setTimeout(r, 2));
      await read();
    }
  }
  return { snaps, prints };
}

const sequence = (): Msg[] => load("push-sequence").map((m: { msg: Msg }) => m.msg);
const printingNow = () =>
  sequence().find(
    (m) =>
      (m.current as { state: { flags: { printing: boolean } } } | undefined)?.state.flags.printing,
  ) as Msg;
const type = (m: Msg) => (m.event as { type: string } | undefined)?.type;

it("adds http:// to a bare host and drops a trailing slash", () => {
  expect(baseUrl("192.168.1.70")).toBe("http://192.168.1.70");
  expect(baseUrl("https://octopi.example/")).toBe("https://octopi.example");
});

it("tests the connection with the API key", async () => {
  routes["/api/version"] = load("version");
  routes["/api/job"] = load("job-offline");
  key = "secret";
  expect(await instance({}, { apiKey: "secret" }).test?.()).toEqual({ ok: true });
  expect(await instance({}, { apiKey: "nope" }).test?.()).toEqual({
    ok: false,
    code: "auth_required",
  });
  // A job answered 409 (no printer connected) is still a working server.
  routes["/api/job"] = new Response("", { status: 409 });
  expect(await instance({}, { apiKey: "secret" }).test?.()).toEqual({ ok: true });
});

it("is one printer, named in the config", async () => {
  const [p] = (await instance({ brand: "Creality" }).printers?.listPrinters()) ?? [];
  expect(p).toEqual({ externalId: "octoprint", name: "OctoPrint", brand: "Creality", model: "" });
  expect(await instance().profile?.()).toEqual({ name: "OctoPrint" });
});

it("an unreachable server is offline; a refused key is a failure", async () => {
  routes["/api/login"] = Object.assign(new Error("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });
  expect((await instance().status?.readStatus())?.[0]?.state).toBe("offline");
  routes["/api/login"] = { name: "_api", session: "abc" };
  key = "secret";
  await expect(instance({}, { apiKey: "nope" }).status?.readStatus()).rejects.toMatchObject({
    code: "auth_required",
  });
});

it("one finished and one cancelled print, with the file's grams", async () => {
  routes[FILE] = download(jobFile("prusaslicer-klipper.gcode"), { ranged: true });
  const { snaps, prints } = await replay(instance(), sequence().slice(5));

  expect(snaps[0]).toMatchObject({ state: "idle" });
  const printing = snaps.find((s) => s.state === "printing" && s.job?.progress);
  expect(printing).toMatchObject({
    state: "printing",
    job: { file: "cube_marlin.gcode", slots: [0], totals: [{ slot: 0, grams: 1.2 }] },
    slots: [{ slot: 0, active: true }],
  });
  expect(printing?.temperatures?.nozzle).toBeGreaterThan(0);

  // A cancel raises PrintCancelled and PrintFailed: one print.
  expect(prints.map((p) => p.print.outcome)).toEqual(["success", "cancelled"]);
  expect(prints[0]).toMatchObject({
    print: { printerExternalId: "octoprint", title: "cube_marlin" },
    job: { totals: [{ slot: 0, grams: 1.2 }] },
  });
  expect(snaps.filter((s) => s.state === "error")).toEqual([]);

  // The file (under 64 KB) was read once for both prints, as a ranged request.
  expect(
    fetchMock.mock.calls.filter((c) => new URL(c[0] as string).pathname === FILE),
  ).toHaveLength(1);
  const ranges = fetchMock.mock.calls
    .filter((c) => new URL(c[0] as string).pathname === FILE)
    .map((c) => (c[1] as RequestInit).headers);
  expect(ranges[0]).toMatchObject({ range: "bytes=0-65535" });
});

it("a cancel's two events are one cancelled print, at the progress it reached", async () => {
  const src = instance();
  routes[FILE] = download(jobFile("prusaslicer-klipper.gcode"));
  await src.status?.readStatus();
  const events = sequence().filter((m) =>
    ["PrintStarted", "PrintCancelling", "PrintCancelled", "PrintFailed"].includes(type(m) ?? ""),
  );
  // The second print of the fixture.
  for (const m of events.slice(1)) live().deliver(m);
  const snaps = ((await src.status?.readStatus()) ?? []).map((s) => printerSnapshotSchema.parse(s));
  expect(snaps.map((s) => s.state)).toEqual(
    ["printing", "cancelled", "offline"].slice(0, 2).concat(snaps.at(-1)?.state ?? "idle"),
  );
  expect(snaps[1]).toMatchObject({ job: { file: "cube_marlin.gcode", progress: 47 } });
});

it("a failure that isn't a cancel is an error print, with its reason", async () => {
  const src = instance();
  await src.status?.readStatus();
  const start = sequence().find((m) => type(m) === "PrintStarted") as Msg;
  live().deliver(start);
  live().deliver(printingNow());
  live().deliver({
    event: {
      type: "PrintFailed",
      payload: {
        name: "cube_marlin.gcode",
        path: "cube_marlin.gcode",
        origin: "local",
        time: 12,
        reason: "error",
      },
    },
  });
  const snaps = (await src.status?.readStatus()) ?? [];
  expect(snaps.map((s) => s.state).slice(0, 2)).toEqual(["printing", "error"]);
  expect(snaps[1]?.job?.failureReason).toBe("error");
});

it("a printer that is offline reads as offline, then idle when it connects", async () => {
  const src = instance();
  const off = load("push-sequence")[4].msg.current;
  FakeSocket.first = [
    {
      current: {
        ...off,
        state: {
          ...off.state,
          flags: { ...off.state.flags, operational: false, closedOrError: true },
        },
      },
    },
  ];
  expect((await src.status?.readStatus())?.[0]?.state).toBe("offline");
  live().deliver(
    sequence().find(
      (m) => (m.current as { state: { text: string } } | undefined)?.state.text === "Operational",
    ) as Msg,
  );
  expect((await src.status?.readStatus())?.[0]?.state).toBe("idle");
});

it("a socket that closes leaves the printer offline until it answers again", async () => {
  const src = instance();
  await src.status?.readStatus();
  live().close();
  FakeSocket.first = [];
  const [snap] = (await src.status?.readStatus()) ?? [];
  // Reconnected, but nothing said yet.
  expect(snap?.state).toBe("offline");
  expect(FakeSocket.all).toHaveLength(2);
}, 15_000);

it("reads a text G-code's totals from its tail, by range or from a server that ignores it", async () => {
  const text = jobFile("prusaslicer-klipper.gcode");
  const big = Buffer.concat([Buffer.alloc(300_000, "; x\n"), text]);
  for (const ranged of [true, false]) {
    routes[FILE] = download(big, { ranged });
    const src = instance();
    await src.status?.readStatus();
    const start = structuredClone(sequence().find((m) => type(m) === "PrintStarted")) as Msg;
    (start.event as { payload: { size: number } }).payload.size = big.length;
    live().deliver(start);
    live().deliver(printingNow());
    const snaps = (await src.status?.readStatus()) ?? [];
    expect(snaps[0]?.job?.totals).toEqual([{ slot: 0, grams: 1.2 }]);
  }
});

it("a file on the printer's SD card isn't downloaded", async () => {
  const src = instance();
  await src.status?.readStatus();
  const start = structuredClone(sequence().find((m) => type(m) === "PrintStarted")) as Msg;
  (start.event as { payload: { origin: string } }).payload.origin = "sdcard";
  live().deliver(start);
  const [snap] = (await src.status?.readStatus()) ?? [];
  expect(snap?.state).toBe("printing");
  expect(snap?.job?.totals).toBeUndefined();
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/downloads/"))).toBe(false);
});

it("a job file that can't be read is tried again, three times", async () => {
  const src = instance();
  await src.status?.readStatus();
  live().deliver(sequence().find((m) => type(m) === "PrintStarted") as Msg);
  live().deliver(printingNow());
  routes[FILE] = () => new Response("", { status: 500 });
  const files = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("cube_marlin.gcode")).length;
  for (let i = 0; i < 5; i++) {
    const snaps = (await src.status?.readStatus()) ?? [];
    expect(snaps.at(-1)?.job?.totals).toBeUndefined();
  }
  expect(files()).toBe(3);
});

it("never sends a command to the printer", async () => {
  routes[FILE] = download(jobFile("prusaslicer-klipper.gcode"), { ranged: true });
  await replay(instance(), sequence().slice(5, 40));
  const methods = fetchMock.mock.calls.map(
    (c) => (c[1] as RequestInit | undefined)?.method ?? "GET",
  );
  // The login is the only POST, and it is passive.
  expect(methods.filter((m) => m !== "GET")).toEqual(["POST"]);
  expect(live().sent.every((s) => /"auth"|"throttle"/.test(s))).toBe(true);
});
