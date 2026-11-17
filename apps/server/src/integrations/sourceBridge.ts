import {
  type DeviceSource,
  type ExternalPrint,
  type ExternalPrinter,
  type HubEvent,
  INTEGRATION_ERROR_CODES,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type IntegrationInstance,
  type LibrarySpool,
  spoolCreatedSchema,
  spoolUsageWrittenSchema,
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

// Printers and a spool library a hub reaches through a connector (ADR-0015, LAN reach). The
// connector runs the adapter on its own network, and its job tracker for a printer; the hub asks it
// for a test, the printers, history and spools (`sources.read`), and takes the live status and
// ended prints it posts (`hubDeviceSources.ts`). Nothing here or there sends a command to a
// printer. The one write: what prints took, to a spool library's spools (`spools.write`, Step 14b).

const { devices, integrations } = schema;
type Row = typeof integrations.$inferSelect;

/** A history page can be long (Moonraker's reads the printer's own list); so can a spool list. */
const LONG_MS = 30_000;
/** A write is a few requests to the library on the connector's side, and waits for the one before. */
const WRITE_MS = 30_000;
const historyPage = z.object({
  items: z.array(z.unknown()).max(1000),
  nextCursor: z.string().max(4096).optional(),
});

/**
 * Can this adapter be reached through a connector: a printer on the network with a live status, or
 * a spool library on the network (Spoolman).
 */
export const bridgeable = (adapter?: Pick<IntegrationAdapter, "kind" | "capabilities">) =>
  adapter?.kind === "host" &&
  adapter.capabilities.some((c) => c === "printerStatus" || c === "spools" || c === "spoolUsage");

/** The connector's answer as the adapter's error; the hub's own (offline, timeout) as unreachable. */
const codeOf = (code: string): IntegrationErrorCode =>
  (INTEGRATION_ERROR_CODES as readonly string[]).includes(code)
    ? (code as IntegrationErrorCode)
    : "unknown";

export function createSourceBridge(
  db: Db,
  channel: HubChannel,
  key: Buffer,
  adapters: IntegrationAdapter[],
) {
  type Read = Extract<HubEvent, { type: "sources.read" }>;
  type Write = Extract<HubEvent, { type: "spools.write" }>["write"];

  /** A read (`sources.read`) or a spool write (`spools.write`) of one source, on its connector. */
  async function ask<T extends z.ZodType>(
    row: Row & { deviceId: string },
    what: { read: Read["op"]; q?: Pick<Read, "since" | "until" | "cursor"> } | { write: Write },
    result: T,
    ms?: number,
  ): Promise<z.infer<T>> {
    if (!channel.online(row.deviceId)) throw new IntegrationError("unreachable");
    const integrationId = row.id;
    try {
      return await channel.ask(
        row.deviceId,
        (requestId): HubEvent =>
          "write" in what
            ? { type: "spools.write", requestId, integrationId, write: what.write }
            : { type: "sources.read", requestId, integrationId, op: what.read, ...what.q },
        result,
        {
          ...(ms && { ms }),
          error: (err) =>
            err.code === "ENOTSUP"
              ? new IntegrationError("unknown", "The connector can't do this for the source")
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
     * The hub's side of a source reached through a connector: what the syncer and the spool
     * write-back ask of it goes to the connector. No status: the connector posts it.
     */
    instance(row: Row & { deviceId: string }, adapter: IntegrationAdapter): IntegrationInstance {
      const caps = adapter.capabilities;
      return {
        test: (): Promise<TestResult> => ask(row, { read: "test" }, testResultSchema),
        ...(caps.includes("printers") && {
          printers: {
            listPrinters: async () =>
              (await ask(
                row,
                { read: "printers" },
                z.array(z.unknown()).max(100),
              )) as ExternalPrinter[],
          },
        }),
        ...(caps.includes("prints") && {
          printHistory: {
            listPrints: async (q) => {
              const page = await ask(row, { read: "history", q }, historyPage, LONG_MS);
              // Each item is checked by the syncer, as an adapter's.
              return page as { items: ExternalPrint[]; nextCursor?: string };
            },
          },
        }),
        ...(caps.includes("spools") && {
          spools: {
            // Each spool is checked by the syncer (`readSpools`), as an adapter's.
            listSpools: async () =>
              (await ask(
                row,
                { read: "spools" },
                z.array(z.unknown()).max(10_000),
                LONG_MS,
              )) as LibrarySpool[],
          },
        }),
        // The same keys as a library on this network: the adapter on the connector makes a retry
        // harmless (ADR-0015, Spoolman two-way).
        ...(caps.includes("spoolUsage") && {
          spoolUsage: {
            writeUsage: (u) =>
              ask(row, { write: { op: "usage", ...u } }, spoolUsageWrittenSchema, WRITE_MS),
            createSpool: (spool) =>
              ask(row, { write: { op: "create", spool } }, spoolCreatedSchema, WRITE_MS),
          },
        }),
      };
    },

    /**
     * The sources a device runs: working ones assigned to it, a printer with its status on, a
     * spool library with its spools or usage line on.
     */
    assigned(deviceId: string): DeviceSource[] {
      const rows = new Map(
        (["printerStatus", "spools", "spoolUsage"] as const)
          .flatMap((cap) => capableRows(db, adapters, cap))
          .filter(({ row, adapter }) => row.deviceId === deviceId && bridgeable(adapter))
          .map(({ row }) => [row.id, row]),
      );
      return [...rows.values()].map((row) => ({
        integrationId: row.id,
        adapterId: row.adapterId,
        config: row.config as DeviceSource["config"],
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
        throw new HttpError(
          400,
          "not_printer_host",
          "Only a printer or a spool library on the network can use this",
        );
      if (!readPreferences(db).hubEnabled)
        throw new HttpError(409, "hub_off", "Turn the hub on to reach a source through a machine");
      if (!db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId)).get())
        throw new HttpError(400, "unknown_device", "No such machine");
      const runs = channel.sourceAdapters(deviceId);
      if (runs && !runs.includes(adapter.id))
        throw new HttpError(409, "device_outdated", "The connector is too old for this source");
    },

    /** The assignment changed: the connector fetches it again (a connect does too). */
    tell: (deviceId: string) => void channel.tell(deviceId, { type: "sources.changed" }),
  };
}

export type SourceBridge = ReturnType<typeof createSourceBridge>;
