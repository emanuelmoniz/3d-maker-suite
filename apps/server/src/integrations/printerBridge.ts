import {
  type DevicePrinter,
  type ExternalPrint,
  type ExternalPrinter,
  INTEGRATION_ERROR_CODES,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type IntegrationInstance,
  type TestResult,
  testResultSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { readPreferences } from "../lib/preferences.ts";
import { capableRows } from "./capabilities.ts";
import { readSecrets } from "./secrets.ts";

// Printers a hub reaches through a connector (ADR-0015, LAN reach). The connector runs the adapter
// on its own network and its job tracker; the hub asks it for a test, the printers and history
// (`printers.read`), and takes the live status and ended prints it posts (`hubDevice.ts`). Read
// only: nothing here or there sends a command to a printer.

const { devices, integrations } = schema;
type Row = typeof integrations.$inferSelect;

/** A history page can be long: Moonraker's reads the printer's own list. */
const HISTORY_MS = 30_000;
const historyPage = z.object({
  items: z.array(z.unknown()).max(1000),
  nextCursor: z.string().max(4096).optional(),
});

/** Can this adapter be reached through a connector: a printer on the network with a live status. */
export const bridgeable = (adapter?: Pick<IntegrationAdapter, "kind" | "capabilities">) =>
  adapter?.kind === "host" && adapter.capabilities.includes("printerStatus");

/** The connector's answer as the adapter's error; the hub's own (offline, timeout) as unreachable. */
const codeOf = (code: string): IntegrationErrorCode =>
  (INTEGRATION_ERROR_CODES as readonly string[]).includes(code)
    ? (code as IntegrationErrorCode)
    : "unknown";

export function createPrinterBridge(
  db: Db,
  channel: HubChannel,
  key: Buffer,
  adapters: IntegrationAdapter[],
) {
  async function ask<T extends z.ZodType>(
    row: Row & { deviceId: string },
    op: "test" | "printers" | "history",
    result: T,
    q: { since?: string; until?: string; cursor?: string } = {},
    ms?: number,
  ): Promise<z.infer<T>> {
    if (!channel.online(row.deviceId)) throw new IntegrationError("unreachable");
    try {
      return await channel.ask(
        row.deviceId,
        (requestId) => ({ type: "printers.read", requestId, integrationId: row.id, op, ...q }),
        result,
        {
          ...(ms && { ms }),
          error: (err) =>
            err.code === "ENOTSUP"
              ? new IntegrationError("unknown", "The connector is too old for printers")
              : new IntegrationError(codeOf(String(err.code))),
        },
      );
    } catch (err) {
      // Offline meanwhile, no answer in time or an answer that doesn't fit.
      if (err instanceof HttpError) throw new IntegrationError("unreachable", err.message);
      throw err;
    }
  }

  return {
    /**
     * The hub's side of a source reached through a connector: what the syncer asks of it goes to
     * the connector. No status (the connector posts it) and no spools.
     */
    instance(row: Row & { deviceId: string }, adapter: IntegrationAdapter): IntegrationInstance {
      const caps = adapter.capabilities;
      return {
        test: (): Promise<TestResult> => ask(row, "test", testResultSchema),
        ...(caps.includes("printers") && {
          printers: {
            listPrinters: async () =>
              (await ask(row, "printers", z.array(z.unknown()).max(100))) as ExternalPrinter[],
          },
        }),
        ...(caps.includes("prints") && {
          printHistory: {
            listPrints: async (q) => {
              const page = await ask(row, "history", historyPage, q, HISTORY_MS);
              // Each item is checked by the syncer, as an adapter's.
              return page as { items: ExternalPrint[]; nextCursor?: string };
            },
          },
        }),
      };
    },

    /** The sources a device runs: working ones with their status on, assigned to it. */
    assigned(deviceId: string): DevicePrinter[] {
      return capableRows(db, adapters, "printerStatus")
        .filter(({ row, adapter }) => row.deviceId === deviceId && bridgeable(adapter))
        .map(({ row }) => ({
          integrationId: row.id,
          adapterId: row.adapterId,
          config: row.config as DevicePrinter["config"],
          secrets: readSecrets(db, key, row.id),
        }));
    },

    online: (deviceId: string) => channel.online(deviceId),

    /**
     * May this source be reached through `deviceId`: a printer on the network, the hub on, the
     * device paired, and its connector able to run the adapter (unknown while it's offline).
     */
    check(adapter: IntegrationAdapter, deviceId: string) {
      if (!bridgeable(adapter))
        throw new HttpError(400, "not_printer_host", "Only a printer on the network can use this");
      if (!readPreferences(db).hubEnabled)
        throw new HttpError(409, "hub_off", "Turn the hub on to reach printers through a machine");
      if (!db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId)).get())
        throw new HttpError(400, "unknown_device", "No such machine");
      const runs = channel.printerAdapters(deviceId);
      if (runs && !runs.includes(adapter.id))
        throw new HttpError(409, "device_outdated", "The connector is too old for this printer");
    },

    /** The assignment changed: the connector fetches it again (a connect does too). */
    tell: (deviceId: string) => void channel.tell(deviceId, { type: "printers.changed" }),
  };
}

export type PrinterBridge = ReturnType<typeof createPrinterBridge>;
