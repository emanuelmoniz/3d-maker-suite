import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bambuStudioAdapter } from "@3d-maker-suite/adapter-bambu";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  BUILT_IN_ROLE_IDS,
  type IntegrationAdapter,
  type RoleBuiltIn,
  type TypeSyncResult,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import type { LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { hashPassword } from "./lib/password.ts";

// A page's Sync (Step 5 of 6.1.0): `POST /api/integrations/sync` with the page's types.

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let dataDir: string;
let db: ReturnType<typeof openDb>;

const start = async (adapters: IntegrationAdapter[]) => {
  db = openDb(":memory:");
  dataDir = mkdtempSync(join(tmpdir(), "sync-types-"));
  app = await buildApp(db, false, dataDir, { adapters });
};
afterEach(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

type Send = (
  method: "POST" | "PATCH",
  url: string,
  payload?: object,
) => Promise<LightMyRequestResponse>;
const anon: Send = (method, url, payload) => app.inject({ method, url, payload });
const add = async (send: Send, token = "t", adapterId = "mock") =>
  (await send("POST", "/api/integrations", { adapterId, secrets: { token } })).json().id as string;
const setPolicy = (send: Send, id: string, type: string, policy: object) =>
  send("PATCH", `/api/integrations/${id}`, { policies: [{ type, ...policy }] });
const syncTypes = (send: Send, types: string[]) =>
  send("POST", "/api/integrations/sync", { types });
const results = async (send: Send, types: string[]) =>
  (await syncTypes(send, types)).json().results as TypeSyncResult[];
/** What each line did, without the counts. */
const lines = (rs: TypeSyncResult[], id?: string) =>
  rs
    .filter((r) => !id || r.integrationId === id)
    .map((r) => [r.type, r.status, ...(r.code ? [r.code] : [])].join(" "));

describe("sync by data type", () => {
  it("runs Auto types only: Manual and Off are left out", async () => {
    await start([mockAdapter(fixture())]);
    const id = await add(anon);
    // The mock's defaults: printers and prints Auto, spools Manual.
    expect(lines(await results(anon, ["printers", "prints", "spools"]))).toEqual([
      "printers ok",
      "prints ok",
    ]);
    await setPolicy(anon, id, "prints", { mode: "manual" });
    await setPolicy(anon, id, "printers", { mode: "off" });
    await setPolicy(anon, id, "spools", { mode: "auto" });
    expect(lines(await results(anon, ["printers", "prints", "spools"]))).toEqual(["spools ok"]);
    // None on Auto: nothing to run, not an error.
    const none = await syncTypes(anon, ["prints"]);
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ results: [] });
  });

  it("counts what was written and what waits for review", async () => {
    const state = fixture();
    await start([mockAdapter(state)]);
    const id = await add(anon);
    // A new printer is written.
    expect(await results(anon, ["printers"])).toEqual([
      {
        integrationId: id,
        type: "printers",
        status: "ok",
        updated: state.printers.length,
        pending: 0,
      },
    ]);
    // A change to one you have waits for review (merge `review`).
    const [first] = state.printers;
    if (first) first.name = "Renamed";
    expect(await results(anon, ["printers"])).toEqual([
      { integrationId: id, type: "printers", status: "ok", updated: 0, pending: 1 },
    ]);
  });

  it("rejects an empty or unknown type list", async () => {
    await start([mockAdapter(fixture())]);
    expect((await syncTypes(anon, [])).statusCode).toBe(400);
    expect((await syncTypes(anon, ["slice"])).statusCode).toBe(400);
  });

  it("an error in one source doesn't stop the others; its later types are skipped", async () => {
    await start([mockAdapter(fixture())]);
    const good = await add(anon, "good");
    // The mock refuses this key on every call.
    const bad = await add(anon, "wrong");
    const rs = await results(anon, ["printers", "prints"]);
    expect(lines(rs, good)).toEqual(["printers ok", "prints ok"]);
    expect(lines(rs, bad)).toEqual([
      "printers error auth_required",
      "prints skipped auth_required",
    ]);
  });

  it("a source already syncing is skipped as sync_running, the rest run", async () => {
    const state = fixture();
    let entered = () => {};
    const inside = new Promise<void>((r) => {
      entered = r;
    });
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const base = mockAdapter(state);
    const gated: IntegrationAdapter = {
      ...base,
      id: "mock-gated",
      create: (ctx) => {
        const made = base.create?.(ctx);
        if (!made?.printers) throw new Error("no instance");
        const { listPrinters } = made.printers;
        return {
          ...made,
          printers: {
            listPrinters: async (...a) => {
              entered();
              await gate;
              return listPrinters(...a);
            },
          },
        };
      },
    };
    await start([base, gated]);
    const other = await add(anon);
    const held = await add(anon, "t", "mock-gated");
    const first = anon("POST", `/api/integrations/${held}/sync`, { type: "printers" });
    await inside;
    const rs = await results(anon, ["printers"]);
    expect(lines(rs, held)).toEqual(["printers skipped sync_running"]);
    expect(lines(rs, other)).toEqual(["printers ok"]);
    release();
    expect((await first).json().status).toBe("ok");
  });

  it("runs only what the caller may sync", async () => {
    const hash = await hashPassword("password123");
    await start([mockAdapter(fixture())]);
    const user = (role: RoleBuiltIn) =>
      db
        .insert(schema.users)
        .values({
          email: `${role}@x.io`,
          displayName: role,
          roleId: BUILT_IN_ROLE_IDS[role],
          passwordHash: hash,
        })
        .run();
    const session = async (role: RoleBuiltIn): Promise<Send> => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: `${role}@x.io`, password: "password123" },
      });
      const cookie = String(res.headers["set-cookie"] ?? "").split(";")[0] ?? "";
      return (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
    };
    for (const role of ["admin", "editor", "viewer"] as const) user(role);
    const [admin, editor, viewer] = [
      await session("admin"),
      await session("editor"),
      await session("viewer"),
    ];
    const closed = await add(admin, "a");
    const open = await add(admin, "b");
    await setPolicy(admin, open, "printers", { editorSync: true });

    const forEditor = await results(editor, ["printers"]);
    expect(forEditor.map((r) => r.integrationId)).toEqual([open]);
    expect((await syncTypes(viewer, ["printers"])).statusCode).toBe(403);
    expect((await results(admin, ["printers"])).map((r) => r.integrationId).sort()).toEqual(
      [closed, open].sort(),
    );
  });

  it("runs catalog types in adapter order: brands, then models, then presets", async () => {
    await start([bambuStudioAdapter()]);
    const id = (await anon("POST", "/api/integrations", { adapterId: "bambu-studio" })).json()
      .id as string;
    const cfg = mkdtempSync(join(dataDir, "cfg-"));
    await anon("PATCH", `/api/integrations/${id}`, { slicerConfigDir: cfg });
    const rs = await results(anon, ["filamentPresets", "printerModels", "brands"]);
    expect(rs.map((r) => r.type)).toEqual(["brands", "printerModels", "filamentPresets"]);
  });
});
