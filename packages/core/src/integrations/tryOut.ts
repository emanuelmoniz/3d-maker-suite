import {
  FOUND_PRINTERS_MAX,
  type FoundPrinter,
  type SourceTestResult,
} from "../schemas/integrations.ts";
import { type IntegrationAdapter, IntegrationError, type Logger } from "./index.ts";

/** How long a test before saving may take: a Bambu printer answers its first report within 10 s. */
export const TRY_OUT_MS = 30_000;

/**
 * Tests a source that isn't saved (yet): `test()`, then the printers it finds. One-shot: the
 * instance is aborted after it, and a key the adapter refreshes stays in memory and is dropped.
 * Used by the server and, through a machine, by its connector (ADR-0014 `sources.test`).
 */
export async function tryOut(
  adapter: IntegrationAdapter,
  {
    config,
    secrets,
    log,
    ms = TRY_OUT_MS,
  }: {
    /** Already validated with `configSchema`. */
    config: unknown;
    secrets: Record<string, string>;
    log: Logger;
    ms?: number;
  },
): Promise<SourceTestResult> {
  if (!adapter.create) return { ok: false, code: "unknown" };
  const abort = new AbortController();
  const kept = { ...secrets };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IntegrationError("unreachable", "No answer in time")), ms);
  });
  try {
    const instance = adapter.create({
      config,
      secrets: {
        get: async (k) => kept[k],
        set: async (k, v) => {
          kept[k] = v;
        },
        delete: async (k) => {
          delete kept[k];
        },
      },
      log,
      signal: abort.signal,
    });
    const tested = await Promise.race([instance.test(), late]);
    if (!tested.ok) return tested;
    const found = instance.printers
      ? await Promise.race([instance.printers.listPrinters(), late])
      : [];
    const printers: FoundPrinter[] = found
      .slice(0, FOUND_PRINTERS_MAX)
      .map(({ externalId, name, brand, model, serial }) => ({
        externalId,
        name,
        brand,
        model,
        ...(serial && { serial }),
      }));
    return { ok: true, printers };
  } catch (err) {
    return { ok: false, code: err instanceof IntegrationError ? err.code : "unknown" };
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
