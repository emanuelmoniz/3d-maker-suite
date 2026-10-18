import {
  type ExternalPrint,
  type ExternalPrinter,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type LibrarySpool,
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
    capabilities: ["printers", "prints", "spools", "slice"],
    configSchema: z.object({ label: z.string().optional() }),
    // No real program runs; the integration still needs a `slicerPath` that exists (any file).
    slicer: {
      slice: async (_program, _configDir, req) => {
        state.sliced = [...(state.sliced ?? []), req];
        if (state.sliceError) throw new IntegrationError("slice_failed", state.sliceError);
        return fakeSlice(req);
      },
    },
    secretsSchema: z.object({ token: z.string().min(1) }),
    create: ({ secrets }) => {
      const check = async () => {
        if (state.fail) throw new IntegrationError(state.fail);
        if (!(await secrets.get("token"))) throw new IntegrationError("auth_required");
      };
      return {
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
