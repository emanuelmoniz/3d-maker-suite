// One printer per network source (6.0.0 Step 17, ADR-0015): a printer on the network is linked to
// one printer when it is saved, never by a printers sync; a source that names its printer by serial
// reads it from that printer.

import {
  fixture,
  type MockState,
  mockAdapter,
  mockHostAdapter,
} from "@3d-maker-suite/adapter-mock";
import type { IntegrationAdapter, PrinterSnapshot } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "./app.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let state: MockState;
/** The configs the serial-reading adapter was made with, last one last. */
let seen: Record<string, unknown>[];

/**
 * A printer on the network that names its printer by serial, as Bambu LAN does: from its config,
 * else from what the printer says (its certificate, here "CERT1").
 */
const bySerial = (): IntegrationAdapter => ({
  id: "by-serial",
  kind: "host",
  capabilities: ["printers", "printerStatus"],
  configSchema: z
    .object({ host: z.string().optional(), serial: z.string().optional() })
    .refine((c) => !!c.host || !!c.serial),
  configAnyOf: ["host", "serial"],
  secretsSchema: z.object({ accessCode: z.string() }),
  create: ({ config }) => {
    const c = config as { serial?: string };
    seen.push(c);
    const serial = c.serial ?? "CERT1";
    return {
      test: async () => ({ ok: true }),
      printers: {
        listPrinters: async () => [
          { externalId: serial, name: "Lan printer", brand: "Mock", model: "M1", serial },
        ],
      },
      status: { readStatus: async () => [] },
    };
  },
});

const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, ...(payload && { payload }) });

beforeEach(async () => {
  db = openDb(":memory:");
  state = { ...fixture(), status: [] };
  seen = [];
  app = await buildApp(db, false, "", {
    adapters: [mockHostAdapter(state), mockAdapter(state), bySerial()],
  });
});
afterEach(() => app.close());

/** A printer added by hand, with no serial unless given. */
async function byHand(name: string, serial?: string) {
  const brand =
    (await send("GET", "/api/brands")).json().items[0] ??
    (await send("POST", "/api/brands", { name: "Voron" })).json();
  const model = (
    await send("POST", "/api/printer-models", { brandId: brand.id, model: name })
  ).json();
  const made = await send("POST", "/api/printers", {
    name,
    modelId: model.id,
    ...(serial && { serial }),
  });
  expect(made.statusCode).toBe(201);
  return made.json().id as string;
}

const klipper = (printer?: string, token = "t") =>
  send("POST", "/api/integrations", {
    adapterId: "mock-host",
    config: { host: "voron.lan" },
    secrets: { token },
    ...(printer && { printer }),
  });
const printers = () => db.select().from(schema.printers).all();
const links = () => db.select().from(schema.printerSources).all();

describe("a printer on the network is one printer, linked at save", () => {
  it("links a printer added by hand, which is never imported again", async () => {
    const mine = await byHand("Voron 2.4");
    const made = await klipper(mine);
    expect(made.statusCode).toBe(201);
    const id = made.json().id as string;
    expect(made.json()).toMatchObject({ printerId: mine });
    expect(links()).toMatchObject([{ printerId: mine, integrationId: id, externalId: "mock-1" }]);
    // It keeps its name and model.
    expect(printers()).toMatchObject([{ id: mine, name: "Voron 2.4", origin: "manual" }]);
    // No printers line: it has no printers sync, and none runs.
    const types = made.json().policies.map((p: { type: string }) => p.type);
    expect(types).not.toContain("printers");
    expect(types).toContain("prints");
    const sync = await send("POST", `/api/integrations/${id}/sync`, { type: "printers" });
    expect(sync.statusCode).toBe(409);
    const policy = await send("PATCH", `/api/integrations/${id}`, {
      policies: [{ type: "printers", mode: "auto" }],
    });
    expect(policy.json().error.code).toBe("invalid_policy");
    // Its history and its live status land on your printer.
    const prints = await send("POST", `/api/integrations/${id}/sync`, { type: "prints" });
    expect(prints.statusCode).toBe(200);
    expect(db.select().from(schema.prints).all().length).toBeGreaterThan(0);
    expect(
      db
        .select()
        .from(schema.prints)
        .all()
        .every((p) => p.printerId === mine),
    ).toBe(true);
    const snap: PrinterSnapshot = {
      printerExternalId: "mock-1",
      at: new Date().toISOString(),
      state: "idle",
      slots: [],
    };
    state.status = [snap];
    app.printerStatus.refresh();
    await app.printerStatus.pollAll();
    expect(app.printerStatus.all()).toMatchObject([{ printerId: mine, integrationId: id }]);
    expect(printers()).toHaveLength(1);
  });

  it("makes a new printer from what it says, with its serial", async () => {
    const made = await klipper("new");
    expect(made.statusCode).toBe(201);
    const id = made.json().id as string;
    expect(printers()).toMatchObject([
      {
        name: "Mock printer",
        serial: "MOCK0001",
        origin: "integration",
        integrationId: id,
        externalId: "mock-1",
      },
    ]);
    expect(made.json().printerId).toBe(printers()[0]?.id);
  });

  it("a new printer with the serial of one you have (its cloud account's) is that one", async () => {
    const cloud = (
      await send("POST", "/api/integrations", {
        adapterId: "mock",
        secrets: { token: "t" },
      })
    ).json().id as string;
    await send("POST", `/api/integrations/${cloud}/sync`, { type: "printers" });
    const [printer] = printers();
    const made = await klipper("new");
    expect(made.json()).toMatchObject({ printerId: printer?.id });
    expect(printers()).toHaveLength(1);
    expect(links()).toMatchObject([{ printerId: printer?.id, integrationId: made.json().id }]);
  });

  it("asks for the printer, and saves nothing when the printer doesn't answer", async () => {
    const none = await klipper();
    expect(none.statusCode).toBe(400);
    expect(none.json().error.code).toBe("printer_required");
    const wrong = await klipper("new", "wrong");
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.code).toBe("auth_required");
    expect(db.select().from(schema.integrations).all()).toEqual([]);
    expect(printers()).toEqual([]);
  });

  it("one printer is one network source's", async () => {
    const mine = await byHand("Voron 2.4");
    expect((await klipper(mine)).statusCode).toBe(201);
    const twice = await klipper(mine);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe("printer_has_source");
    const gone = await klipper("00000000-0000-4000-8000-000000000000");
    expect(gone.statusCode).toBe(404);
  });

  it("another printer moves the link; the one it had stays, unlinked", async () => {
    const made = (await klipper("new")).json();
    const first = made.printerId as string;
    const other = await byHand("Voron 0");
    const moved = await send("PATCH", `/api/integrations/${made.id}`, { printer: other });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().printerId).toBe(other);
    expect(links()).toMatchObject([{ printerId: other, integrationId: made.id }]);
    expect(printers().find((p) => p.id === first)).toMatchObject({
      integrationId: null,
      externalId: null,
    });
    // An account is no printer on the network.
    const cloud = (
      await send("POST", "/api/integrations", {
        adapterId: "mock",
        secrets: { token: "t" },
      })
    ).json().id as string;
    const not = await send("PATCH", `/api/integrations/${cloud}`, { printer: other });
    expect(not.json().error.code).toBe("not_printer_host");
  });

  it("deleting the integration keeps the printer, unlinked", async () => {
    const mine = await byHand("Voron 2.4");
    const id = (await klipper(mine)).json().id as string;
    expect((await send("DELETE", `/api/integrations/${id}`)).statusCode).toBe(204);
    expect(printers()).toMatchObject([{ id: mine }]);
    expect(links()).toEqual([]);
    // Free again for another source.
    expect((await klipper(mine)).statusCode).toBe(201);
  });
});

describe("the serial belongs to the printer", () => {
  const lan = (printer: string, config: object) =>
    send("POST", "/api/integrations", {
      adapterId: "by-serial",
      config,
      secrets: { accessCode: "c" },
      printer,
    });

  it("a source that reads it gets it from its printer, and keeps none of its own", async () => {
    const mine = await byHand("A1", "S9");
    // No address: the printer's serial is enough.
    const made = await lan(mine, {});
    expect(made.statusCode).toBe(201);
    expect(made.json().config).toEqual({});
    expect(seen.at(-1)).toEqual({ serial: "S9" });
    expect(links()).toMatchObject([{ printerId: mine, externalId: "S9" }]);
    // What it is made with, here and on a connector, has the printer's serial.
    seen = [];
    await send("POST", `/api/integrations/${made.json().id}/test`);
    expect(seen.at(-1)).toEqual({ serial: "S9" });
  });

  it("a new printer gets the serial the printer gave, and a printer with none is asked for its IP", async () => {
    const made = await lan("new", { host: "a1.lan" });
    expect(made.json().config).toEqual({ host: "a1.lan" });
    expect(printers()).toMatchObject([{ serial: "CERT1", integrationId: made.json().id }]);
    const bare = await byHand("A1 mini");
    const none = await lan(bare, {});
    expect(none.statusCode).toBe(400);
    expect(none.json().error.code).toBe("invalid_config");
  });

  it("is read-only on the printer while a source gives it; a Moonraker printer's isn't", async () => {
    const mine = await byHand("A1", "S9");
    const id = (await lan(mine, {})).json().id as string;
    const page = (await send("GET", `/api/printers/${mine}`)).json();
    expect(page).toMatchObject({
      serial: "S9",
      serialFrom: id,
      sources: [{ integrationId: id, adapterId: "by-serial" }],
    });
    const edit = await send("PATCH", `/api/printers/${mine}`, { serial: "S10" });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.code).toBe("serial_from_source");
    // The same serial, or none sent, is no change.
    expect((await send("PATCH", `/api/printers/${mine}`, { serial: "S9" })).statusCode).toBe(200);
    expect((await send("PATCH", `/api/printers/${mine}`, { name: "A1 2" })).statusCode).toBe(200);
    const voron = await byHand("Voron 2.4");
    await klipper(voron);
    expect((await send("GET", `/api/printers/${voron}`)).json()).toMatchObject({
      serialFrom: null,
    });
    expect((await send("PATCH", `/api/printers/${voron}`, { serial: "V1" })).statusCode).toBe(200);
  });

  it("an account that brought the printer in gives its serial", async () => {
    const cloud = (
      await send("POST", "/api/integrations", {
        adapterId: "mock",
        secrets: { token: "t" },
      })
    ).json().id as string;
    await send("POST", `/api/integrations/${cloud}/sync`, { type: "printers" });
    const [printer] = printers();
    expect((await send("GET", `/api/printers/${printer?.id}`)).json()).toMatchObject({
      serial: "MOCK0001",
      serialFrom: cloud,
    });
  });
});
