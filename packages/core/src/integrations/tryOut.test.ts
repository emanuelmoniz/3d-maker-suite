import { expect, test } from "vitest";
import { z } from "zod";
import { type IntegrationAdapter, IntegrationError, type Logger } from "./index.ts";
import { tryOut } from "./tryOut.ts";

const log: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** A printer on the network that wants a key, and remembers what it saw. */
function adapter(
  opts: { throws?: unknown; hangs?: boolean; many?: number } = {},
): IntegrationAdapter & { seen: { signal?: AbortSignal; secrets?: Record<string, string> } } {
  const seen: { signal?: AbortSignal; secrets?: Record<string, string> } = {};
  return {
    seen,
    id: "fake",
    kind: "host",
    capabilities: ["printers"],
    configSchema: z.object({ host: z.string() }),
    secretsSchema: z.object({ key: z.string() }),
    create: ({ secrets, signal }) => {
      seen.signal = signal;
      return {
        test: async () => {
          if (opts.hangs) await new Promise(() => {});
          if (opts.throws) throw opts.throws;
          const key = await secrets.get("key");
          // A refreshed key stays in the test.
          await secrets.set("key", "refreshed");
          return key === "right" ? { ok: true } : { ok: false, code: "auth_required" };
        },
        printers: {
          listPrinters: async () =>
            Array.from({ length: opts.many ?? 1 }, (_, i) => ({
              externalId: `p${i}`,
              name: `Voron ${i}`,
              brand: "Klipper",
              model: "Voron 2.4",
              ...(i === 0 && { serial: "S0" }),
              nozzleDiameterMm: 0.4,
            })),
        },
      };
    },
  };
}

test("finds the printer and aborts afterwards", async () => {
  const a = adapter();
  const secrets = { key: "right" };
  expect(await tryOut(a, { config: { host: "h" }, secrets, log })).toEqual({
    ok: true,
    printers: [{ name: "Voron 0", brand: "Klipper", model: "Voron 2.4", serial: "S0" }],
  });
  expect(a.seen.signal?.aborted).toBe(true);
  // The caller's keys are never changed.
  expect(secrets).toEqual({ key: "right" });
});

test("a wrong key is the adapter's own answer", async () => {
  expect(await tryOut(adapter(), { config: {}, secrets: { key: "wrong" }, log })).toEqual({
    ok: false,
    code: "auth_required",
  });
});

test("a thrown error is its code, or unknown", async () => {
  const thrown = (e: unknown) => tryOut(adapter({ throws: e }), { config: {}, secrets: {}, log });
  expect(await thrown(new IntegrationError("unreachable"))).toEqual({
    ok: false,
    code: "unreachable",
  });
  expect(await thrown(new Error("boom"))).toEqual({ ok: false, code: "unknown" });
});

test("no answer in time is unreachable", async () => {
  const a = adapter({ hangs: true });
  expect(await tryOut(a, { config: {}, secrets: {}, log, ms: 20 })).toEqual({
    ok: false,
    code: "unreachable",
  });
  expect(a.seen.signal?.aborted).toBe(true);
});

test("an account's printers are capped", async () => {
  const r = await tryOut(adapter({ many: 50 }), { config: {}, secrets: { key: "right" }, log });
  expect(r.ok && r.printers).toHaveLength(20);
});
