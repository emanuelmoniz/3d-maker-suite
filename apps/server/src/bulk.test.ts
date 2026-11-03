import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILT_IN_ROLE_IDS, BULK_MAX_IDS, type BulkKind } from "@3d-maker-suite/core";
import { openDb, schema, seed } from "@3d-maker-suite/db";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.ts";
import { hashPassword } from "./lib/password.ts";

const evaluateAlerts = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./alerts/evaluate.ts", async (original) => ({
  ...(await original<typeof import("./alerts/evaluate.ts")>()),
  evaluateAlerts,
}));

const PW = "password123";
const UNKNOWN = "00000000-0000-4000-8000-00000000abcd";
let hash: string;
let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  hash = await hashPassword(PW);
});
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bulk-"));
  db = openDb(":memory:");
  seed(db);
  app = await buildApp(db, false, dir);
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const bulk = (kind: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `/api/bulk/${kind}`, payload, headers });
const made = async (url: string, payload: object): Promise<string> => {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};
let n = 0;
const client = () => made("/api/clients", { name: `Ana ${++n}`, mobile: `91${n}` });

/** Signs in a new user of the Editor role, with these permissions over it. */
const signIn = async (
  permissions: Record<string, string>,
  projectRights: Record<string, boolean> = {},
) => {
  const name = `user${++n}`;
  const user = db
    .insert(schema.users)
    .values({
      email: `${name}@x.io`,
      displayName: name,
      roleId: BUILT_IN_ROLE_IDS.editor,
      passwordHash: hash,
      permissions,
      projectRights,
    })
    .returning()
    .get();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: user.email, password: PW },
  });
  return { user, cookie: String(res.headers["set-cookie"]).split(";")[0] ?? "" };
};

describe("POST /api/bulk/:kind", () => {
  it("archives and restores, one result per row, without touching the others", async () => {
    const [a, b, c] = [await client(), await client(), await client()];
    const res = await bulk("clients", { action: "archive", ids: [a, b] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ done: [a, b], blocked: [] });
    const archived = async (id?: string) =>
      (await app.inject(`/api/clients/${id}`)).json().archivedAt !== null;
    expect([await archived(a), await archived(b), await archived(c)]).toEqual([true, true, false]);

    await bulk("clients", { action: "restore", ids: [a] });
    expect(await archived(a)).toBe(false);
  });

  it("a blocked row is reported with its details; the free ones around it still go", async () => {
    const [free1, used, free2] = [await client(), await client(), await client()];
    const project = await made("/api/projects", { name: "Vase" });
    await made("/api/orders", { projectIds: [project], price: 5, clientId: used });

    const res = await bulk("clients", { action: "delete", ids: [free1, used, free2] });
    expect(res.statusCode, res.body).toBe(200);
    const { done, blocked } = res.json();
    expect(done).toEqual([free1, free2]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ id: used, code: "in_use" });
    expect(blocked[0].details.dependents[0]).toMatchObject({ type: "order", total: 1 });
    expect((await app.inject(`/api/clients/${free1}`)).statusCode).toBe(404);
    expect((await app.inject(`/api/clients/${used}`)).statusCode).toBe(200);
  });

  it("reports a row's own refusal and an unknown id, and runs a repeated id once", async () => {
    const printer = await made("/api/printers", {
      name: "P",
      modelId: await made("/api/printer-models", {
        brandId: await made("/api/brands", { name: "B" }),
        model: "X",
      }),
      state: "working",
    });
    const accessory = await made("/api/accessories", {
      name: "AMS",
      type: "AMS",
      state: "working",
    });
    await made(`/api/accessories/${accessory}/installs`, {
      printerId: printer,
      installedAt: "2026-01-01T10:00:00.000Z",
    });
    const { blocked } = (
      await bulk("printers", { action: "archive", ids: [printer, printer, UNKNOWN] })
    ).json();
    expect(blocked.map((b: { id: string; code: string }) => [b.id, b.code])).toEqual([
      [printer, "printer_has_accessories"],
      [UNKNOWN, "not_found"],
    ]);
  });

  it("refuses a bad request as a whole", async () => {
    const id = await client();
    expect((await bulk("users", { action: "archive", ids: [id] })).statusCode).toBe(400);
    expect((await bulk("clients", { action: "archive", ids: [] })).statusCode).toBe(400);
    expect((await bulk("clients", { action: "hide", ids: [id] })).statusCode).toBe(400);
    const tooMany = Array.from({ length: BULK_MAX_IDS + 1 }, () => id);
    expect((await bulk("clients", { action: "archive", ids: tooMany })).statusCode).toBe(400);
    expect((await app.inject(`/api/clients/${id}`)).json().archivedAt).toBeNull();
  });
});

describe("who may", () => {
  /** A row of each module, made while the app is still in the no-users mode. */
  const row: [BulkKind, "printers" | "costs", () => Promise<string>][] = [
    ["brands", "printers", () => made("/api/brands", { name: `B${++n}` })],
    ["clients", "costs", client],
  ];

  it.each(row)("%s needs manage on %s, not write", async (kind, module, make) => {
    const id = await make();
    const writer = await signIn({ [module]: "write" });
    const refused = await bulk(kind, { action: "archive", ids: [id] }, { cookie: writer.cookie });
    expect(refused.statusCode).toBe(403);
    expect((await bulk(kind, { action: "archive", ids: [id] })).statusCode).toBe(401);

    const manager = await signIn({ [module]: "manage" });
    const res = await bulk(kind, { action: "archive", ids: [id] }, { cookie: manager.cookie });
    expect(res.json()).toEqual({ done: [id], blocked: [] });
  });

  it("a module's manage says nothing about another module", async () => {
    const id = await client();
    const { cookie } = await signIn({ printers: "manage", costs: "write" });
    expect((await bulk("clients", { action: "delete", ids: [id] }, { cookie })).statusCode).toBe(
      403,
    );
  });

  it("checks each project: a download-only and a hidden one are reported, by id only", async () => {
    const owner = await signIn({ projects: "manage" });
    const mine = (
      await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "Mine" },
        headers: { cookie: owner.cookie },
      })
    ).json().id;
    const reader = await signIn({ projects: "manage" }, { "projects.editOthers": false });
    const own = (
      await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "Reader's" },
        headers: { cookie: reader.cookie },
      })
    ).json().id;
    const readOnly = await bulk(
      "projects",
      { action: "archive", ids: [mine, own] },
      { cookie: reader.cookie },
    );
    expect(readOnly.json().done).toEqual([own]);
    expect(readOnly.json().blocked).toMatchObject([{ id: mine, code: "forbidden" }]);

    const solo = await signIn({ projects: "manage" }, { "projects.seeAll": false });
    const hidden = await bulk(
      "projects",
      { action: "archive", ids: [mine] },
      { cookie: solo.cookie },
    );
    expect(hidden.json().blocked).toMatchObject([{ id: mine, code: "not_found" }]);
    expect(hidden.body).not.toContain("Mine");
  });
});

describe("alert checks", () => {
  it("a bulk action is one check, not one per row", async () => {
    const scheduled = await buildApp(db, false, dir, { alertsSchedule: "0 0 1 1 *" });
    await scheduled.ready();
    const ids: string[] = [];
    for (let i = 0; i < 30; i++)
      ids.push(
        (
          await scheduled.inject({
            method: "POST",
            url: "/api/clients",
            payload: { name: `C${i}`, mobile: `80${i}` },
          })
        ).json().id,
      );
    const settled = () => new Promise((r) => setTimeout(r, 50));
    await settled();
    evaluateAlerts.mockClear();
    const res = await scheduled.inject({
      method: "POST",
      url: "/api/bulk/clients",
      payload: { action: "archive", ids },
    });
    expect(res.json().done).toHaveLength(30);
    await settled();
    expect(evaluateAlerts).toHaveBeenCalledTimes(1);
    await scheduled.close();
  });
});
