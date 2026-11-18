import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type IntegrationInstance,
  type PrinterSnapshot,
  printerSnapshotSchema,
  type TrackerState,
  track,
} from "@3d-maker-suite/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authorize, parseChallenge } from "./digest.ts";
import { baseUrl, prusalinkAdapter } from "./index.ts";

// The Step 1 fixtures (fixtures/SOURCE.md: others' payloads, no printer confirmed them), served
// by a fake `fetch`, and the job-file fixtures of packages/3mf.

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
const jobFile = (name: string) =>
  readFileSync(new URL(`../../../3mf/fixtures/job-headers/${name}`, import.meta.url));

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const NONCE = "dcd98b7102dd2f0e8b11d0f600bfb0c093";
const CHALLENGE = `Digest realm="Printer API", nonce="${NONCE}", qop="auth", opaque="5ccc069c403ebaf9f0171e9517f40e41"`;

type Answer = unknown | ((url: URL, req: Request) => unknown);
let routes: Record<string, Answer>;
let fetchMock: ReturnType<typeof vi.fn>;
/** What the fake printer asks of a request: a password (Digest), an API key, or nothing. */
let signIn: "digest" | "key" | "none";

beforeEach(() => {
  routes = {};
  signIn = "none";
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe("http://prusa.local");
    const req = new Request(url, init);
    if (signIn === "digest") {
      const auth = req.headers.get("authorization") ?? "";
      const ok =
        auth.startsWith("Digest ") &&
        auth.includes(`response="${answerFor(auth, url.pathname + url.search)}"`);
      if (!ok) return new Response("", { status: 401, headers: { "www-authenticate": CHALLENGE } });
    }
    if (signIn === "key" && req.headers.get("x-api-key") !== "secret")
      return new Response("", { status: 401 });
    const answer = routes[url.pathname];
    if (answer === undefined) return new Response("not found", { status: 404 });
    const body = typeof answer === "function" ? answer(url, req) : answer;
    if (body instanceof Response) return body;
    if (body instanceof Error) throw body;
    return Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The response the printer expects for user `maker` and password `pass`. */
function answerFor(auth: string, uri: string) {
  const nc = /nc=(\w+)/.exec(auth)?.[1];
  const cnonce = /cnonce="([^"]+)"/.exec(auth)?.[1];
  const ha1 = md5("maker:Printer API:pass");
  return md5(`${ha1}:${NONCE}:${nc}:${cnonce}:auth:${md5(`GET:${uri}`)}`);
}

const silent = { debug() {}, info() {}, warn() {}, error() {} };
function instance(
  config: Record<string, unknown> = {},
  secrets: Record<string, string> = {},
): IntegrationInstance {
  const adapter = prusalinkAdapter();
  const create = adapter.create;
  if (!create) throw new Error("no create");
  return create({
    config: adapter.configSchema.parse({ host: "prusa.local", ...config }),
    secrets: {
      get: async (k) => secrets[k],
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

const noJob = () => new Response(null, { status: 204 });
const withState = (status: string, job = true) => {
  const s = load("status-printing");
  s.printer.state = status;
  if (!job) s.job = undefined;
  return s;
};
const download =
  (bytes: Buffer, opts: { ranged?: boolean } = {}) =>
  (_: URL, req: Request) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") ?? "");
    if (opts.ranged && m) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) + 1 : bytes.length;
      return new Response(new Uint8Array(bytes.subarray(from, to)), { status: 206 });
    }
    return new Response(new Uint8Array(bytes));
  };

it("adds http:// to a bare host and drops a trailing slash", () => {
  expect(baseUrl("192.168.1.60")).toBe("http://192.168.1.60");
  expect(baseUrl("https://prusa.example/")).toBe("https://prusa.example");
});

it("answers a Digest challenge the way RFC 7616 does", () => {
  // RFC 2617's worked example (MD5, qop=auth).
  const c = parseChallenge(
    'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
  );
  if (!c) throw new Error("no challenge");
  const header = authorize(c, "Mufasa", "Circle Of Life", "GET", "/dir/index.html", 1, "0a4f113b");
  expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
  expect(header).toContain("nc=00000001");
  expect(parseChallenge("Basic realm=x")).toBeUndefined();
});

it("signs in with Digest after a challenge, and with the API key", async () => {
  signIn = "digest";
  routes["/api/v1/status"] = load("status-idle");
  const ok = await instance({}, { password: "pass" }).test?.();
  expect(ok).toEqual({ ok: true });
  // A challenge, then the answer; the next request answers at once.
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await instance({}, { password: "wrong" }).test?.()).toEqual({
    ok: false,
    code: "auth_required",
  });
  expect(await instance().test?.()).toEqual({ ok: false, code: "auth_required" });

  signIn = "key";
  expect(await instance({}, { apiKey: "secret" }).test?.()).toEqual({ ok: true });
  expect(await instance({}, { apiKey: "nope" }).test?.()).toEqual({
    ok: false,
    code: "auth_required",
  });
});

it("names the printer from its info", async () => {
  routes["/api/v1/info"] = load("info");
  const [p] = (await instance({ model: "XL" }).printers?.listPrinters()) ?? [];
  expect(p).toEqual({
    externalId: "prusalink",
    name: "PrusaXL",
    brand: "Prusa",
    model: "XL",
    serial: "serial-1337",
    nozzleDiameterMm: 0.4,
  });
  expect(await instance().profile?.()).toEqual({ name: "PrusaXL" });
});

it("an idle printer, or one that keeps its last job, is idle with no job", async () => {
  routes["/api/v1/status"] = load("status-idle");
  routes["/api/v1/job"] = load("job-idle-mk3");
  const [snap] = (await instance().status?.readStatus()) ?? [];
  expect(snap).toMatchObject({
    state: "idle",
    temperatures: { nozzle: 47.8, nozzleTarget: 210.1, bed: 41.9, bedTarget: 60.5 },
  });
  expect(snap?.job).toBeUndefined();
  // The job isn't asked for while nothing prints.
  expect(fetchMock.mock.calls.map((c) => new URL(c[0] as string).pathname)).toEqual([
    "/api/v1/status",
  ]);
});

it("a printer that doesn't answer is offline; a wrong password is a failure", async () => {
  routes["/api/v1/status"] = Object.assign(new Error("fetch failed"), {
    cause: { code: "EHOSTUNREACH" },
  });
  expect((await instance().status?.readStatus())?.[0]?.state).toBe("offline");
  signIn = "key";
  await expect(instance().status?.readStatus()).rejects.toMatchObject({ code: "auth_required" });
});

it("a print read from a .bgcode's head: finished, with the file's grams", async () => {
  const base = {
    "/api/v1/job": load("job-printing"),
    "/api/printer": load("legacy-printer"),
    "/usb/TabletStand3~4.BGC": download(jobFile("prusaslicer.bgcode"), { ranged: true }),
  };
  const { snaps, prints } = await watch(instance(), [
    { ...base, "/api/v1/status": load("status-printing") },
    { "/api/v1/status": load("status-printing") },
    { "/api/v1/status": withState("FINISHED"), "/api/v1/job": noJob },
    { "/api/v1/status": load("status-idle"), "/api/v1/job": noJob },
  ]);
  expect(snaps[0]).toMatchObject({
    state: "printing",
    job: {
      id: "129",
      file: "TabletStand3.bgcode",
      elapsedSec: 43987,
      progress: 37,
      etaSec: 73020,
      slots: [0],
      totals: [{ slot: 0, grams: 1.2 }],
    },
    slots: [{ slot: 0, material: "PLA", active: true }],
    temperatures: { nozzle: 6, nozzleTarget: 0, bed: 53.9, bedTarget: 85 },
  });
  // Once per job: the job, the legacy path and the file, then only the status.
  const paths = fetchMock.mock.calls.map((c) => new URL(c[0] as string).pathname);
  expect(paths.filter((p) => p === "/api/v1/job")).toHaveLength(1);
  expect(paths.filter((p) => p === "/usb/TabletStand3~4.BGC")).toHaveLength(1);
  // The head was asked for, not the print.
  const ranged = fetchMock.mock.calls.find((c) => String(c[0]).endsWith(".BGC"));
  expect((ranged?.[1] as RequestInit | undefined)?.headers).toMatchObject({
    range: "bytes=0-65535",
  });

  expect(prints).toHaveLength(1);
  expect(prints[0]).toMatchObject({
    print: {
      externalId: "129",
      printerExternalId: "prusalink",
      title: "TabletStand3",
      outcome: "success",
    },
    job: { totals: [{ slot: 0, grams: 1.2 }] },
  });
});

it("a stopped print is a cancelled one, with no grams the printer measured", async () => {
  const { prints } = await watch(instance(), [
    {
      "/api/v1/status": load("status-printing"),
      "/api/v1/job": load("job-printing"),
      "/api/printer": load("legacy-printer"),
      "/usb/TabletStand3~4.BGC": download(jobFile("prusaslicer.bgcode")),
    },
    { "/api/v1/status": withState("STOPPED"), "/api/v1/job": noJob },
    { "/api/v1/status": load("status-idle") },
  ]);
  expect(prints).toHaveLength(1);
  expect(prints[0]?.print).toMatchObject({ externalId: "129", outcome: "cancelled" });
  expect(prints[0]?.print.filaments.every((f: { grams?: number }) => f.grams === undefined)).toBe(
    true,
  );
});

it("an error is a failed print; ATTENTION is a paused one", async () => {
  const src = instance();
  const first = await watch(src, [
    {
      "/api/v1/status": withState("ATTENTION"),
      "/api/v1/job": load("job-printing"),
      "/usb/TabletStand3~4.BGC": download(jobFile("prusaslicer.bgcode")),
    },
    { "/api/v1/status": withState("ERROR") },
  ]);
  expect(first.snaps.map((s) => s.state)).toEqual(["paused", "error"]);
  expect(first.prints[0]?.print.outcome).toBe("failed");
});

it("reads a text G-code's totals from its tail, by range or from a printer that ignores it", async () => {
  const text = jobFile("prusaslicer-klipper.gcode");
  // A big file: the totals are far from its head.
  const big = Buffer.concat([Buffer.alloc(300_000, "; x\n"), text]);
  for (const ranged of [true, false]) {
    const job = load("job-printing");
    job.file.refs.download = "/usb/BIG.GCO";
    job.file.size = big.length;
    const { snaps } = await watch(instance(), [
      {
        "/api/v1/status": load("status-printing"),
        "/api/v1/job": job,
        "/usb/BIG.GCO": download(big, { ranged }),
      },
    ]);
    expect(snaps[0]?.job?.totals).toEqual([{ slot: 0, grams: 1.2 }]);
  }
});

it("a job file that can't be read is tried again, three times", async () => {
  const src = instance();
  routes["/api/v1/status"] = load("status-printing");
  routes["/api/v1/job"] = load("job-printing");
  routes["/usb/TabletStand3~4.BGC"] = new Response("", { status: 500 });
  const files = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(".BGC")).length;
  for (let i = 0; i < 5; i++) {
    routes["/usb/TabletStand3~4.BGC"] = () => new Response("", { status: 500 });
    const [snap] = (await src.status?.readStatus()) ?? [];
    expect(snap?.job?.totals).toBeUndefined();
  }
  expect(files()).toBe(3);
  routes["/usb/TabletStand3~4.BGC"] = () => new Response(jobFile("prusaslicer.bgcode"));
  // Out of tries for this job: the next one starts afresh.
  const [again] = (await src.status?.readStatus()) ?? [];
  expect(again?.job?.totals).toBeUndefined();
});
