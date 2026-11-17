import {
  type ExternalPrint,
  type ExternalPrinter,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type LibrarySpool,
  type PrinterSnapshot,
  type SliceRequest,
  type SliceResult,
} from "@3d-maker-suite/core";
import { z } from "zod";

// A fake vendor for tests and for clicking through the UI (APP_MOCK_INTEGRATION=1).
// `state` is plain data: change it between syncs to simulate the vendor.

export type MockState = {
  printers: ExternalPrinter[];
  prints: ExternalPrint[];
  spools?: LibrarySpool[];
  /** What the printers are doing now; unset = `liveStatus`, a print that loops with the clock. */
  status?: PrinterSnapshot[];
  /** Every call throws this code. */
  fail?: IntegrationErrorCode;
  /** The fake slicer fails with this text. */
  sliceError?: string;
  /** Every slice request, for tests. */
  sliced?: SliceRequest[];
};

/**
 * The fake slicer's numbers: plate N takes N hours; each slot gets 10 g, +5 g with a filament
 * preset picked, +50% with a process preset picked. Plain enough to assert on in tests.
 */
export function fakeSlice(req: SliceRequest): SliceResult {
  const factor = req.process ? 1.5 : 1;
  const slots = Math.max(1, req.filaments?.length ?? 0);
  const filaments = Array.from({ length: slots }, (_, i) => ({
    slot: i + 1,
    grams: (req.filaments?.[i] ? 15 : 10) * factor,
    material: "PLA",
  }));
  return {
    printTimeSeconds: 3600 * req.plate * factor,
    weightGrams: filaments.reduce((g, f) => g + f.grams, 0),
    filaments,
  };
}

export const LIVE_CYCLE_SEC = 600;
const LIVE_GRAMS = 12;
const LIVE_LAYERS = 50;

/**
 * The fake printer's status at `now`, the same print every `cycleSec` (ten minutes): idle for the
 * first tenth, heating for the next, printing for seven, then finished for the last. It takes 12 g
 * from slot 0, the filament of the fake history's prints.
 */
export function liveStatus(now = Date.now(), cycleSec = LIVE_CYCLE_SEC): PrinterSnapshot {
  const t = Math.floor(now / 1000) % cycleSec;
  const cycle = Math.floor(now / 1000) - t;
  const [heat, print, end] = [0.1, 0.2, 0.9].map((f) => Math.round(cycleSec * f)) as [
    number,
    number,
    number,
  ];
  const done = Math.min(1, Math.max(0, (t - print) / (end - print)));
  const printing = t >= print && t < end;
  const snap = (
    state: PrinterSnapshot["state"],
    job?: PrinterSnapshot["job"],
  ): PrinterSnapshot => ({
    printerExternalId: "mock-1",
    at: new Date(now).toISOString(),
    state,
    job,
    temperatures: {
      nozzle: t < heat ? 25 : printing ? 220 : 120,
      nozzleTarget: printing || (t >= heat && t < print) ? 220 : 0,
      bed: t < heat ? 25 : 60,
      bedTarget: t >= heat && t < end ? 60 : 0,
    },
    slots: [
      {
        slot: 0,
        material: "PLA",
        colorHex: "#ff8800",
        active: printing,
        ...(t >= heat && { gramsUsed: Math.round(LIVE_GRAMS * done * 100) / 100 }),
      },
    ],
  });
  if (t < heat) return snap("idle");
  const job = {
    id: `live-${cycle}`,
    file: "mock-live.gcode",
    title: "Mock live print",
    startedAt: new Date((cycle + heat) * 1000).toISOString(),
    elapsedSec: Math.min(t, end) - heat,
    progress: Math.round(done * 100),
    etaSec: Math.max(0, end - t),
    layer: Math.floor(done * LIVE_LAYERS),
    totalLayers: LIVE_LAYERS,
  };
  return snap(t < print ? "preparing" : printing ? "printing" : "finished", job);
}

/**
 * The live loop as a source reads it: a print's end that fell between two reads is returned first,
 * as `PrinterStatusSource` asks.
 */
export function liveSource(cycleSec: number) {
  let last: string | undefined;
  let ended: string | undefined;
  return (now = Date.now()) => {
    let s = liveStatus(now, cycleSec);
    if (last && last !== s.job?.id && ended !== last) {
      const start = Number(last.slice("live-".length));
      s = liveStatus((start + cycleSec * 0.95) * 1000, cycleSec);
    }
    last = s.job?.id ?? last;
    if (s.state === "finished") ended = s.job?.id;
    return s;
  };
}

export const PAGE_SIZE = 2;

export function fixture(): MockState {
  const print = (n: number, outcome: ExternalPrint["outcome"] = "success"): ExternalPrint => ({
    externalId: `job-${n}`,
    printerExternalId: "mock-1",
    title: `Mock print ${n}`,
    startedAt: new Date(Date.UTC(2026, 0, n, 10)).toISOString(),
    durationSec: 3600 * n,
    outcome,
    ...(outcome === "success" ? {} : { failureReason: "Spaghetti" }),
    filaments: [{ slot: 0, material: "PLA", colorHex: "#ff8800", grams: 10 * n }],
  });
  return {
    printers: [
      {
        externalId: "mock-1",
        name: "Mock printer",
        brand: "Mock",
        model: "M1",
        serial: "MOCK0001",
      },
    ],
    prints: [print(1), print(2, "failed"), print(3)],
  };
}

export function mockAdapter(state: MockState = fixture()): IntegrationAdapter {
  return {
    id: "mock",
    kind: "cloud",
    capabilities: ["printers", "prints", "spools", "slice", "printerStatus"],
    configSchema: z.object({
      label: z.string().optional(),
      // The live print's loop; short in e2e, so a print ends while the test waits.
      liveCycleSec: z.number().int().min(20).max(3600).optional(),
    }),
    // No real program runs; the integration still needs a `slicerPath` that exists (any file).
    slicer: {
      slice: async (_program, _configDir, req) => {
        state.sliced = [...(state.sliced ?? []), req];
        if (state.sliceError) throw new IntegrationError("slice_failed", state.sliceError);
        return fakeSlice(req);
      },
    },
    secretsSchema: z.object({ token: z.string().min(1) }),
    create: ({ config, secrets }) => {
      const { label, liveCycleSec } = config as { label?: string; liveCycleSec?: number };
      const live = liveSource(liveCycleSec ?? LIVE_CYCLE_SEC);
      const check = async () => {
        if (state.fail) throw new IntegrationError(state.fail);
        const token = await secrets.get("token");
        // "wrong": a key the printer refuses (a test before saving, e2e).
        if (!token || token === "wrong") throw new IntegrationError("auth_required");
      };
      return {
        // Named after the token, so two mock accounts tell apart.
        profile: async () => {
          await check();
          return { email: `${await secrets.get("token")}@example.com`, name: label };
        },
        test: async () => {
          try {
            await check();
            return { ok: true };
          } catch (e) {
            return { ok: false, code: (e as IntegrationError).code };
          }
        },
        printers: {
          listPrinters: async () => {
            await check();
            return state.printers;
          },
        },
        printHistory: {
          listPrints: async ({ since, until, cursor }) => {
            await check();
            const all = state.prints.filter(
              (p) => (!since || p.startedAt >= since) && (!until || p.startedAt <= until),
            );
            const start = Number(cursor ?? 0);
            const end = start + PAGE_SIZE;
            return {
              items: all.slice(start, end),
              nextCursor: end < all.length ? String(end) : undefined,
            };
          },
        },
        status: {
          readStatus: async () => {
            await check();
            return state.status ?? [live()];
          },
        },
        spools: {
          listSpools: async () => {
            await check();
            return state.spools ?? [];
          },
        },
      };
    },
  };
}

/**
 * The fake printer as a printer on the network (`host`), for a hub that reaches it through a
 * connector (ADR-0015, LAN reach): the same state, printers, history and live status, no spools.
 */
export function mockHostAdapter(state: MockState = fixture()): IntegrationAdapter {
  const base = mockAdapter(state);
  return {
    id: "mock-host",
    kind: "host",
    capabilities: ["printers", "prints", "printerStatus"],
    configSchema: z.object({
      host: z.string().min(1),
      liveCycleSec: z.number().int().min(20).max(3600).optional(),
    }),
    secretsSchema: base.secretsSchema,
    create: (ctx) => {
      // biome-ignore lint/style/noNonNullAssertion: the mock always has one
      const { test, printers, printHistory, status } = base.create!(ctx);
      return { test, printers, printHistory, status };
    },
  };
}
