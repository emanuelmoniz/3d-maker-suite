import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
  fillGrams,
  type IntegrationInstance,
  printerSnapshotSchema,
  type TrackedPrint,
  type TrackerState,
  track,
} from "@3d-maker-suite/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bambuLanAdapter, type LanDeps, type MqttLink } from "./index.ts";
import { toSnapshot, totalsOnSlots } from "./map.ts";
import { type Announce, parseNotify } from "./ssdp.ts";

// The Step 1 fixtures (fixtures/lan/SOURCE.md) played through a fake MQTT link, as the A1 sent
// them, with the job tracker reading the status after each message.

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/lan/${name}`, import.meta.url), "utf8");
const json = (name: string) => JSON.parse(fixture(name));
type Recorded = { at: string; msg: unknown }[];
const SERIAL = "00M00A000000001";
const CODE = "12345678";
/** Bambu Studio's job file of `single_color.3mf`: one filament, 18.73 g (its 4th filament). */
const JOB_3MF = readFileSync(
  new URL("../../../../3mf/fixtures/job-headers/bambu-studio.gcode.3mf", import.meta.url),
);

class FakeLink extends EventEmitter implements MqttLink {
  subscribed: string[] = [];
  published: { topic: string; body: unknown }[] = [];
  ended = false;
  stream = { getPeerCertificate: () => ({ subject: { CN: SERIAL } }) };
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  subscribe(topic: string) {
    this.subscribed.push(topic);
  }
  publish(topic: string, payload: string) {
    this.published.push({ topic, body: JSON.parse(payload) });
  }
  end() {
    this.ended = true;
  }
  send(msg: unknown) {
    this.emit("message", `device/${SERIAL}/report`, Buffer.from(JSON.stringify(msg)));
  }
}

function setup(
  opts: {
    config?: Record<string, unknown>;
    /** What the printer does once it is connected; default: connect, version, full report. */
    onConnect?: (l: FakeLink) => void;
    file?: Buffer;
  } = {},
) {
  const links: FakeLink[] = [];
  // As the real one: a new listener hears the latest announces first.
  const announces: Announce[] = [];
  const listeners = new Set<(a: Announce) => void>();
  const announce = (a: Announce) => {
    announces.push(a);
    for (const l of listeners) l(a);
  };
  const downloads: string[] = [];
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: LanDeps = {
    connect: (url) => {
      const l = new FakeLink(url);
      links.push(l);
      queueMicrotask(() =>
        (
          opts.onConnect ??
          ((x) => {
            x.emit("connect");
            x.send(json("version.json"));
            x.send(json("pushall-idle.json"));
          })
        )(l),
      );
      return l;
    },
    download: async (_host, code, path) => {
      expect(code).toBe(CODE);
      downloads.push(path);
      return path.startsWith("/cache/") ? (opts.file ?? JOB_3MF) : undefined;
    },
    watch: (l) => {
      listeners.add(l);
      for (const a of announces) l(a);
      return () => listeners.delete(l);
    },
  };
  const adapter = bambuLanAdapter(deps);
  const abort = new AbortController();
  const create = adapter.create;
  if (!create) throw new Error("no create");
  const src: IntegrationInstance = create({
    config: adapter.configSchema.parse({ host: "192.0.2.10", ...opts.config }),
    secrets: {
      get: async (k) => (k === "accessCode" ? CODE : undefined),
      set: async () => {},
      delete: async () => {},
    },
    log,
    signal: abort.signal,
  });
  return { src, links, downloads, log, abort, announce };
}

/** Plays a recorded print, reading the status after every message (or only where `readAt` says). */
async function play(name: string, readAt: (i: number) => boolean = () => true) {
  vi.useFakeTimers({ toFake: ["Date"] });
  const s = setup();
  const prints: TrackedPrint[] = [];
  let state: TrackerState = { phase: "idle" };
  const read = async () => {
    for (const snap of (await s.src.status?.readStatus()) ?? []) {
      const out = track(state, printerSnapshotSchema.parse(snap));
      state = out.state;
      prints.push(...out.prints);
    }
  };
  await read(); // connects, reads the idle printer
  const link = s.links[0];
  if (!link) throw new Error("not connected");
  for (const [i, m] of (json(name) as Recorded).entries()) {
    vi.setSystemTime(new Date(m.at));
    const before = s.downloads.length;
    link.send(m.msg);
    // The job file is read in the background: give it the time it takes.
    await new Promise((r) => setTimeout(r, s.downloads.length > before ? 100 : 0));
    if (readAt(i)) await read();
  }
  return { ...s, link, prints };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Bambu LAN, the A1 fixtures through the job tracker", () => {
  it("records the finished print with the cloud's task id, plate, slot, tag and the file's grams", async () => {
    const { prints, downloads, link } = await play("print-1-finish.json");
    expect(link.url).toBe("mqtts://192.0.2.10:8883");
    expect(link.subscribed).toEqual([`device/${SERIAL}/report`]);
    // Only the two read requests.
    expect(link.published.map((p) => Object.values(p.body as object)[0].command)).toEqual([
      "get_version",
      "pushall",
    ]);
    expect(downloads).toEqual(["/cache/test-print.3mf"]);
    expect(prints).toHaveLength(1);
    const [p] = prints;
    expect(p?.print).toEqual({
      externalId: "100000001",
      peerId: "100000001",
      printerExternalId: SERIAL,
      title: "test-print",
      plate: 3,
      // The start command's time: the cloud's own start, to the second.
      startedAt: "2026-11-14T11:25:04.000Z",
      durationSec: 1200,
      outcome: "success",
      filaments: [
        { slot: 0, material: "PLA", colorHex: "#f7d959", rfid: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1" },
      ],
    });
    expect(p?.partial).toBe(false);
    // One filament on one slot: the file's total lands on it.
    expect(p?.job.totals).toEqual([{ slot: 0, grams: 18.73 }]);
    expect(
      fillGrams(p?.print ?? ({} as never), p?.job ?? {}, { file: p?.job.totals }).filaments[0],
    ).toMatchObject({ grams: 18.73, gramsSource: "file" });
  });

  it("records the cancel as cancelled, its grams the file's total by the layer it reached", async () => {
    const { prints } = await play("print-2-failed.json");
    expect(prints).toHaveLength(1);
    const [p] = prints;
    expect(p?.print).toMatchObject({
      externalId: "100000005",
      peerId: "100000005",
      outcome: "cancelled",
      startedAt: "2026-11-14T11:49:26.000Z",
    });
    expect(p?.print.failureReason).toBeUndefined();
    expect(p?.job).toMatchObject({ layer: 6, totalLayers: 45 });
    // The printer's 40% counts time: the layer gives the share of the material (ADR-0015).
    const filled = fillGrams(p?.print ?? ({} as never), p?.job ?? {}, { file: p?.job.totals });
    expect(filled.filaments[0]).toMatchObject({
      grams: 2.5,
      gramsEstimated: true,
      gramsSource: "file",
    });
  });

  it("still says cancelled when the printer reset its error code before the read", async () => {
    // Reads only before the job and after the last message: `print_error` is back to 0 by then.
    const messages = json("print-2-failed.json") as Recorded;
    const failed = messages.findIndex(
      (m) => (m.msg as { print?: { gcode_state?: string } }).print?.gcode_state === "FAILED",
    );
    const { prints } = await play(
      "print-2-failed.json",
      (i) => i < failed || i === messages.length - 1,
    );
    expect(prints.map((p) => p.print.outcome)).toEqual(["cancelled"]);
  });
});

describe("Bambu LAN connection", () => {
  it("reads the serial from the printer's certificate and lists the printer", async () => {
    const { src, announce } = setup();
    announce({ serial: SERIAL, host: "192.0.2.10", modelCode: "N2S", name: "Becas" });
    expect(await src.printers?.listPrinters()).toEqual([
      {
        externalId: SERIAL,
        serial: SERIAL,
        name: "Becas",
        brand: "Bambu Lab",
        model: "A1",
        nozzleDiameterMm: 0.4,
      },
    ]);
    expect(await src.test()).toEqual({ ok: true });
  });

  it("follows the printer to a new address by its serial", async () => {
    const { src, links, announce } = setup({ config: { serial: SERIAL } });
    await src.status?.readStatus();
    announce({ serial: "OTHER", host: "192.0.2.99" });
    announce({ serial: SERIAL, host: "192.0.2.10" });
    expect(links).toHaveLength(1);
    announce({ serial: SERIAL, host: "192.0.2.20" });
    expect(links.map((l) => l.url)).toEqual(["mqtts://192.0.2.10:8883", "mqtts://192.0.2.20:8883"]);
    expect(links[0]?.ended).toBe(true);
  });

  it("finds the printer by its broadcast when only the serial is set", async () => {
    const { src, links, announce } = setup({ config: { host: undefined, serial: SERIAL } });
    expect(links).toHaveLength(0);
    const reading = src.status?.readStatus();
    announce({ serial: SERIAL, host: "192.0.2.30" });
    const [snap] = (await reading) ?? [];
    expect(links[0]?.url).toBe("mqtts://192.0.2.30:8883");
    expect(snap).toMatchObject({ printerExternalId: SERIAL, state: "idle" });
    expect(snap?.slots.map((s) => s.slot)).toEqual([0, 1, 2, 3]);
  });

  it("a wrong access code is the source's failure, not an offline printer", async () => {
    const refuse = (l: FakeLink) =>
      l.emit("error", Object.assign(new Error("Not authorized"), { code: 5 }));
    const { src } = setup({ onConnect: refuse });
    await expect(src.status?.readStatus()).rejects.toMatchObject({ code: "auth_required" });
    const other = setup({ onConnect: refuse });
    expect(await other.src.test()).toEqual({ ok: false, code: "auth_required" });
  });

  it("is offline when the connection drops, and closes when the source stops", async () => {
    const { src, links, abort } = setup();
    await src.status?.readStatus();
    links[0]?.emit("close");
    expect((await src.status?.readStatus())?.[0]?.state).toBe("offline");
    abort.abort();
    expect(links[0]?.ended).toBe(true);
  });

  it("never logs what the printer sends, the access code it broadcasts included", async () => {
    const { src, links, log } = setup();
    await src.status?.readStatus();
    links[0]?.send({ system: { command: "get_access_code", access_code: "SECRET99" } });
    links[0]?.emit("message", "x", Buffer.from("not json SECRET99"));
    links[0]?.emit("error", Object.assign(new Error("boom SECRET99"), { code: "ECONNRESET" }));
    await src.status?.readStatus();
    const logged = JSON.stringify(Object.values(log).flatMap((f) => f.mock.calls));
    expect(logged).not.toContain("SECRET99");
    expect(logged).not.toContain(CODE);
  });
});

describe("toSnapshot's slots", () => {
  it("are what is loaded, the back spool 254 and an AMS HT by its id; complete once reported", () => {
    const report = {
      gcode_state: "IDLE",
      ams: {
        ams: [
          { id: 0, tray: [{ id: 0, tray_type: "PLA", tray_color: "FF8800FF" }, { id: 1 }] },
          { id: 128, tray: [{ id: 0, tray_type: "PETG", tray_color: "000000FF" }] },
        ],
      },
      vt_tray: { tray_type: "TPU", tray_color: "FFFFFFFF" },
    };
    const s = toSnapshot(SERIAL, report, "2026-11-17T10:00:00.000Z", {});
    expect(s.physicalSlots).toBe(true);
    expect(s.slots.map((t) => t.slot)).toEqual([0, 128, 254]);
    // A report without its trays yet says nothing of them.
    expect(toSnapshot(SERIAL, { gcode_state: "IDLE" }, s.at, {}).physicalSlots).toBeUndefined();
  });
});

describe("totalsOnSlots", () => {
  it("places each of the file's filaments on the slot the start command gave it", () => {
    expect(
      totalsOnSlots(
        [
          { slot: 0, grams: 10 },
          { slot: 2, grams: 5 },
        ],
        [3, -1, 1],
      ),
    ).toEqual([
      { slot: 3, grams: 10 },
      { slot: 1, grams: 5 },
    ]);
  });
  it("one filament on one slot needs no mapping; several without one are dropped", () => {
    expect(totalsOnSlots([{ slot: 3, grams: 18.73 }], [0])).toEqual([{ slot: 0, grams: 18.73 }]);
    expect(totalsOnSlots([{ grams: 4 }], undefined, 2)).toEqual([{ slot: 2, grams: 4 }]);
    expect(
      totalsOnSlots(
        [
          { slot: 0, grams: 1 },
          { slot: 1, grams: 2 },
        ],
        undefined,
        2,
      ),
    ).toEqual([]);
    expect(totalsOnSlots([{ grams: 4 }], undefined, 255)).toEqual([]);
  });
});

it("parses the printer's broadcast", () => {
  expect(parseNotify(fixture("ssdp-notify.txt"))).toEqual({
    serial: SERIAL,
    host: "192.0.2.10",
    modelCode: "N2S",
    name: "Printer",
  });
  expect(parseNotify("NOTIFY * HTTP/1.1\r\nNT: upnp:rootdevice\r\n")).toBeUndefined();
});

it("tells the setup form that the IP or the serial is needed, and checks it", () => {
  const adapter = bambuLanAdapter();
  expect(adapter.configAnyOf).toEqual(["host", "serial"]);
  expect(adapter.configSchema.safeParse({ name: "Becas" }).success).toBe(false);
  expect(adapter.configSchema.safeParse({ serial: SERIAL }).success).toBe(true);
});
