import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { modelIdFor } from "./lib/catalog.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "accessories-"));
  db = openDb(":memory:");
  app = await buildApp(db, false, dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload });
const create = async (payload: Record<string, unknown> = {}) =>
  (await req("POST", "/api/accessories", { name: "AMS", type: "AMS", ...payload })).json();
const printer = async (name: string) =>
  (
    await req("POST", "/api/printers", { name, modelId: modelIdFor(db, "Bambu Lab", "P1S") })
  ).json();
const day = (d: number) => new Date(Date.UTC(2026, 0, d)).toISOString();

describe("accessories", () => {
  it("numbers, CRUD, state validation, types, archive/restore", async () => {
    const a = await create();
    expect(a).toMatchObject({ number: 1, state: "working", printerId: null, archivedAt: null });
    expect((await create({ name: "Hotend", type: "Hotend", number: 5 })).number).toBe(5);
    const taken = await req("POST", "/api/accessories", { name: "X", type: "AMS", number: 5 });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe("accessory_number_taken");
    expect((await req("PATCH", `/api/accessories/${a.id}`, { state: "nope" })).statusCode).toBe(
      400,
    );
    expect((await req("PATCH", `/api/accessories/${a.id}`, { serial: "S1" })).json().serial).toBe(
      "S1",
    );
    expect((await req("GET", "/api/accessories/types")).json()).toEqual(["AMS", "Hotend"]);
    expect((await req("GET", "/api/accessories?name=01-ams")).json().items).toHaveLength(1);

    expect((await req("DELETE", `/api/accessories/${a.id}`)).statusCode).toBe(204);
    expect((await req("GET", "/api/accessories")).json().total).toBe(1);
    expect((await req("GET", "/api/accessories?archived=true")).json().total).toBe(1);
    await req("PATCH", `/api/accessories/${a.id}`, { archived: false });
    expect((await req("GET", "/api/accessories")).json().total).toBe(2);
  });

  it("install, remove, install again; overlaps and bad dates are refused", async () => {
    const a = await create();
    const [p1, p2] = [await printer("A"), await printer("B")];
    const base = `/api/accessories/${a.id}/installs`;
    const install = (printerId: string, d: number) =>
      req("POST", base, { printerId, installedAt: day(d) });

    const first = await install(p1.id, 10);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ removedAt: null, printerLabel: "01-A" });
    expect((await req("GET", `/api/accessories/${a.id}`)).json().printerId).toBe(p1.id);
    expect((await req("GET", `/api/accessories?printerId=${p1.id}`)).json().total).toBe(1);
    // Still on p1: a second install anywhere overlaps.
    expect((await install(p2.id, 20)).json().error.code).toBe("install_overlap");
    // Still installed: archiving is refused.
    expect((await req("DELETE", `/api/accessories/${a.id}`)).statusCode).toBe(409);

    const remove = (id: string, d: number) => req("PATCH", `${base}/${id}`, { removedAt: day(d) });
    expect((await remove(first.json().id, 5)).statusCode).toBe(400);
    expect((await remove(first.json().id, 15)).json().removedAt).toBe(day(15));
    expect((await req("GET", `/api/accessories/${a.id}`)).json().printerId).toBeNull();

    // Inside the closed period: overlap. On its removal day: fine.
    expect((await install(p2.id, 12)).statusCode).toBe(409);
    const second = await install(p2.id, 15);
    expect(second.statusCode).toBe(201);
    // Moving the first period's end past the second's start overlaps.
    expect((await remove(first.json().id, 16)).statusCode).toBe(409);
    // An open period started earlier would cover the closed one.
    await remove(second.json().id, 20);
    expect((await install(p1.id, 1)).statusCode).toBe(409);

    const history = (await req("GET", base)).json();
    expect(history.map((h: { printerLabel: string }) => h.printerLabel)).toEqual(["02-B", "01-A"]);
    expect((await req("DELETE", `${base}/${first.json().id}`)).statusCode).toBe(204);
    expect((await req("GET", base)).json()).toHaveLength(1);
    expect((await install(p1.id, 1)).statusCode).toBe(409); // still covers the 15th-20th
    expect((await install(p1.id, 21)).statusCode).toBe(201);
  });

  it("notes timeline", async () => {
    const a = await create();
    const base = `/api/accessories/${a.id}/comments`;
    const c = (await req("POST", base, { body: "Cleaned the feeder" })).json();
    await req("POST", base, { body: "Second" });
    await req("PATCH", `${base}/${c.id}`, { pinned: true });
    expect((await req("GET", base)).json().map((x: { body: string }) => x.body)).toEqual([
      "Cleaned the feeder",
      "Second",
    ]);
    expect((await req("DELETE", `${base}/${c.id}`)).statusCode).toBe(204);
    expect((await req("GET", base)).json()).toHaveLength(1);
  });
});
