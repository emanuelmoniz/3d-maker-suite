import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HIDDEN_PROJECT, PROJECT_TRASH_DIR, type UserRole } from "@3d-maker-suite/core";
import { openDb, schema, seed } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { buildApp } from "./app.ts";
import { projectAccess, type RootRule } from "./lib/auth.ts";
import { hashPassword } from "./lib/password.ts";
import { setRoots } from "./testRoots.ts";

const PW = "password123";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PW);
});

type Rights = Parameters<typeof projectAccess>[0] & {};
const person = (id: string, role: UserRole, rights: Partial<Rights> = {}): Rights => ({
  id,
  role,
  projectsSeeAll: true,
  projectsEditOthers: true,
  editOtherDevices: role === "admin",
  ...rights,
});
const hub = (editBy: RootRule["editBy"] = "roles", editorIds: string[] = []): RootRule => ({
  editBy,
  location: "hub",
  editorIds,
  deviceUserId: null,
});
const device = (owner: string, editBy: RootRule["editBy"] = "roles"): RootRule => ({
  editBy,
  location: "dev-1",
  editorIds: [],
  deviceUserId: owner,
});

// The permission table of ADR-0014, one row per rule.
const CASES: [string, Rights | undefined, string | null, RootRule | null, string][] = [
  ["no users: everything", undefined, null, device("x", "none"), "edit"],
  ["admin: anyone's, no root", person("a", "admin"), "e", null, "edit"],
  ["admin: nobody's", person("a", "admin"), null, hub(), "edit"],
  [
    "admin sees all with see-all off",
    person("a", "admin", { projectsSeeAll: false }),
    "e",
    null,
    "edit",
  ],
  ["editor: own", person("e", "editor"), "e", hub(), "edit"],
  ["editor: other's", person("e", "editor"), "o", hub(), "edit"],
  ["editor: nobody's", person("e", "editor"), null, null, "edit"],
  [
    "editor, edit-others off: other's",
    person("e", "editor", { projectsEditOthers: false }),
    "o",
    hub(),
    "read",
  ],
  [
    "editor, edit-others off: nobody's",
    person("e", "editor", { projectsEditOthers: false }),
    null,
    null,
    "read",
  ],
  [
    "editor, edit-others off: own",
    person("e", "editor", { projectsEditOthers: false }),
    "e",
    hub(),
    "edit",
  ],
  [
    "editor, see-all off: other's hidden",
    person("e", "editor", { projectsSeeAll: false }),
    "o",
    hub(),
    "none",
  ],
  [
    "editor, see-all off: nobody's hidden",
    person("e", "editor", { projectsSeeAll: false }),
    null,
    null,
    "none",
  ],
  [
    "editor, see-all off: own",
    person("e", "editor", { projectsSeeAll: false }),
    "e",
    hub(),
    "edit",
  ],
  ["viewer: other's", person("v", "viewer"), "o", null, "read"],
  [
    "viewer, see-all off: hidden",
    person("v", "viewer", { projectsSeeAll: false }),
    "o",
    null,
    "none",
  ],
  ["root admins: editor", person("e", "editor"), "e", hub("admins"), "read"],
  ["root admins: admin", person("a", "admin"), "e", hub("admins"), "edit"],
  ["root none: admin", person("a", "admin"), "a", hub("none"), "read"],
  ["root users: picked editor", person("e", "editor"), "e", hub("users", ["e"]), "edit"],
  ["root users: unpicked admin", person("a", "admin"), "a", hub("users", ["e"]), "read"],
  ["device: its user", person("e", "editor"), "e", device("e"), "edit"],
  ["device: its user, root none", person("e", "editor"), "e", device("e", "none"), "edit"],
  ["device: other editor", person("o", "editor"), "e", device("e"), "read"],
  [
    "device: other editor with the device right",
    person("o", "editor", { editOtherDevices: true }),
    "e",
    device("e"),
    "edit",
  ],
  ["device: admin", person("a", "admin"), "e", device("e"), "edit"],
  [
    "device: admin without the device right",
    person("a", "admin", { editOtherDevices: false }),
    "e",
    device("e"),
    "read",
  ],
  [
    "device, root admins: editor with the right",
    person("o", "editor", { editOtherDevices: true }),
    "e",
    device("e", "admins"),
    "read",
  ],
  [
    "device, root users: picked without the right",
    person("o", "editor"),
    "e",
    { ...device("e", "users"), editorIds: ["o"] },
    "edit",
  ],
  ["device: viewer who owns it", person("v", "viewer"), "v", device("v"), "read"],
];

describe("project access", () => {
  it.each(CASES)("%s", (_, user, ownerId, root, want) => {
    expect(projectAccess(user, { ownerId }, root)).toBe(want);
  });
});

describe("project access over HTTP", () => {
  const setup = async () => {
    const db = openDb(":memory:");
    const dataDir = mkdtempSync(join(tmpdir(), "access-data-"));
    const dir = mkdtempSync(join(tmpdir(), "access-root-"));
    onTestFinished(() => {
      for (const d of [dataDir, dir]) rmSync(d, { recursive: true, force: true });
    });
    const app = await buildApp(db, { stream: { write: () => true } }, dataDir);
    // Set up in the no-users mode, before anyone logs in.
    const [root] = await setRoots(app, dir);
    const add = (role: UserRole, name: string, rights: Partial<Rights> = {}) =>
      db
        .insert(schema.users)
        .values({
          email: `${name}@x.io`,
          displayName: name,
          role,
          passwordHash: hash,
          editOtherDevices: role === "admin",
          ...rights,
        })
        .returning()
        .get();
    const as = async (user: { email: string }) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: user.email, password: PW },
      });
      const cookie = String(res.headers["set-cookie"]).split(";")[0] ?? "";
      return (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
        app.inject({ method, url, payload, headers: { cookie } });
    };
    return { db, app, dir, root: root ?? { id: "" }, add, as };
  };

  it("hides other people's projects, makes them download-only, and sets the owner", async () => {
    const { db, add, as } = await setup();
    const admin = add("admin", "admin");
    const solo = add("editor", "solo", { projectsSeeAll: false });
    const helper = add("editor", "helper", { projectsEditOthers: false });
    const [asAdmin, asSolo, asHelper] = await Promise.all([as(admin), as(solo), as(helper)]);

    const theirs = (await asAdmin("POST", "/api/projects", { name: "Admin's" })).json();
    expect(theirs.ownerId).toBe(admin.id);
    const own = (await asSolo("POST", "/api/projects", { name: "Solo's" })).json();
    expect(own.ownerId).toBe(solo.id);
    db.update(schema.projects)
      .set({ meta: { files: [], models: [], multicolor: false, materials: ["PETG"] } })
      .run();

    // Hidden: not listed, not in the materials, 404 on every route, also a write.
    const names = async (send: typeof asSolo) =>
      (await send("GET", "/api/projects")).json().items.map((p: { name: string }) => p.name);
    expect(await names(asSolo)).toEqual(["Solo's"]);
    expect(await names(asHelper)).toEqual(["Solo's", "Admin's"]);
    expect((await asSolo("GET", "/api/projects/materials")).json()).toEqual(["PETG"]);
    db.update(schema.projects)
      .set({ meta: { files: [], models: [], multicolor: false, materials: [] } })
      .where(eq(schema.projects.id, own.id))
      .run();
    expect((await asSolo("GET", "/api/projects/materials")).json()).toEqual([]);
    expect((await asSolo("GET", `/api/projects/${theirs.id}`)).statusCode).toBe(404);
    expect((await asSolo("GET", `/api/projects/${theirs.id}/file?path=a.stl`)).statusCode).toBe(
      404,
    );
    expect((await asSolo("PATCH", `/api/projects/${theirs.id}`, { name: "x" })).statusCode).toBe(
      404,
    );

    // Download-only: reads work, writes are 403 on the project, its files and its slicing.
    const seen = (await asHelper("GET", `/api/projects/${theirs.id}`)).json();
    expect(seen).toMatchObject({ canEdit: false, owner: { id: admin.id, displayName: "admin" } });
    expect((await asHelper("GET", `/api/projects/${theirs.id}/slicing`)).statusCode).toBe(200);
    for (const [method, url] of [
      ["PATCH", ""],
      ["DELETE", ""],
      ["DELETE", "/files?path=a.stl"],
      ["PUT", "/slicing"],
      ["POST", "/slicing/run"],
      ["POST", "/open"],
    ] as const)
      expect(
        (await asHelper(method, `/api/projects/${theirs.id}${url}`, {})).statusCode,
        `${method} ${url}`,
      ).toBe(403);
    // Their own stays theirs to change; an admin changes anyone's.
    const mine = (await asHelper("POST", "/api/projects", { name: "Helper's" })).json();
    expect((await asHelper("PATCH", `/api/projects/${mine.id}`, { name: "Mine" })).statusCode).toBe(
      200,
    );
    expect((await asHelper("GET", `/api/projects/${mine.id}`)).json().canEdit).toBe(true);
    expect((await asAdmin("PATCH", `/api/projects/${own.id}`, { name: "Solo 2" })).statusCode).toBe(
      200,
    );
  });

  it("a root's edit setting decides who creates and changes projects in it", async () => {
    const { db, dir, root, add, as } = await setup();
    const admin = add("admin", "admin");
    const editor = add("editor", "editor");
    const picked = add("editor", "picked");
    const viewer = add("viewer", "viewer");
    const [asAdmin, asEditor, asPicked] = await Promise.all([as(admin), as(editor), as(picked)]);
    const create = (send: typeof asAdmin, name: string) =>
      send("POST", "/api/projects", { name, createFolder: true, rootId: root.id });
    const editBy = (body: object) => asAdmin("PATCH", `/api/roots/${root.id}`, body);

    const made = await create(asEditor, "Roles");
    expect(made.statusCode).toBe(201);
    expect(made.json().ownerId).toBe(editor.id);

    expect((await editBy({ editBy: "admins" })).json()).toMatchObject({ editBy: "admins" });
    const before = readdirSync(dir);
    expect((await create(asEditor, "Refused")).statusCode).toBe(403);
    // Refused before anything was made on disk.
    expect(readdirSync(dir)).toEqual(before);
    expect((await asEditor("GET", "/api/roots")).json()[0].canEdit).toBe(false);
    expect(
      (await asEditor("PATCH", `/api/projects/${made.json().id}`, { name: "x" })).statusCode,
    ).toBe(403);

    expect((await editBy({ editBy: "users", editorIds: [viewer.id] })).statusCode).toBe(400);
    expect(
      (await editBy({ editBy: "users", editorIds: [picked.id, picked.id] })).json(),
    ).toMatchObject({
      editBy: "users",
      editorIds: [picked.id],
    });
    expect((await asPicked("GET", "/api/roots")).json()[0]).toMatchObject({ canEdit: true });
    expect((await create(asPicked, "Picked")).statusCode).toBe(201);
    expect((await create(asAdmin, "Admin")).statusCode).toBe(403);

    await editBy({ editBy: "none" });
    const id = made.json().id;
    expect((await asAdmin("PATCH", `/api/projects/${id}`, { name: "x" })).statusCode).toBe(403);
    expect((await asAdmin("GET", `/api/projects/${id}`)).json().canEdit).toBe(false);
    // Picked editors go with the user.
    db.delete(schema.users).where(eq(schema.users.id, picked.id)).run();
    expect((await editBy({ editBy: "roles" })).json().editorIds).toEqual([]);
    expect(existsSync(join(dir, "001_Roles"))).toBe(true);
  });

  it("a device root's projects are its user's; others need the device right", async () => {
    const { db, add, as } = await setup();
    const admin = add("admin", "admin");
    const owner = add("editor", "owner");
    const other = add("editor", "other");
    const [asAdmin, asOwner, asOther] = await Promise.all([as(admin), as(owner), as(other)]);
    const dev = db
      .insert(schema.devices)
      .values({ name: "WS", userId: owner.id, tokenHash: "t" })
      .returning()
      .get();
    const root = db
      .insert(schema.roots)
      .values({ name: "WS", location: dev.id, path: "C:/m", position: 1 })
      .returning()
      .get();
    const p = db
      .insert(schema.projects)
      .values({ number: 9, name: "Box", rootId: root.id, folder: "009_Box", ownerId: owner.id })
      .returning()
      .get();
    const canEdit = async (send: typeof asOwner) =>
      (await send("GET", `/api/projects/${p.id}`)).json().canEdit;

    expect(await canEdit(asOwner)).toBe(true);
    expect(await canEdit(asAdmin)).toBe(true);
    expect(await canEdit(asOther)).toBe(false);
    expect((await asOther("PATCH", `/api/projects/${p.id}`, { name: "x" })).statusCode).toBe(403);
    await asAdmin("PATCH", `/api/users/${other.id}`, { editOtherDevices: true });
    expect(await canEdit(await as(other))).toBe(true);
  });

  it("names no hidden project in prints, orders, quotes, stats, tags or the trash", async () => {
    const { db, dir, root, add, as } = await setup();
    seed(db, new Date());
    const admin = add("admin", "admin");
    const solo = add("editor", "solo", { projectsSeeAll: false });
    const [asAdmin, asSolo] = await Promise.all([as(admin), as(solo)]);
    // The seeded projects are nobody's: hidden from solo.
    const hidden = db.select().from(schema.projects).all();
    const secret = hidden[0];
    if (!secret) throw new Error("seed");
    const own = (await asSolo("POST", "/api/projects", { name: "Solo's" })).json();
    const [p1, p2] = db.select().from(schema.prints).orderBy(schema.prints.number).all();
    if (!p1 || !p2) throw new Error("seed");
    db.update(schema.prints).set({ projectId: secret.id }).where(eq(schema.prints.id, p1.id)).run();
    db.update(schema.prints).set({ projectId: own.id }).where(eq(schema.prints.id, p2.id)).run();
    const order = await asAdmin("POST", "/api/orders", {
      projectIds: [secret.id, own.id],
      price: 1000,
    });
    expect(order.statusCode).toBe(201);
    const quote = await asAdmin("POST", "/api/costs/quotes", {
      name: "Quote",
      projectId: secret.id,
      form: { grams: 1 },
      cost: { material: 1, energy: 0, wear: 0, maintenance: 0, total: 1, unpricedGrams: 0 },
      quote: {
        unitCost: 1,
        labor: 0,
        failureMargin: 0,
        subtotal: 1,
        markup: 0,
        unitPrice: 1,
        quantity: 1,
        total: 1,
      },
    });
    expect(quote.statusCode).toBe(201);

    const [desk] = (await asAdmin("GET", "/api/collections")).json();
    for (const url of [
      "/api/prints?pageSize=100&sort=project",
      `/api/prints/${p1.id}`,
      "/api/orders",
      `/api/orders/${order.json().id}`,
      "/api/costs/quotes?sort=project",
      "/api/stats",
      "/api/tags",
      `/api/collections/${desk.id}`,
    ]) {
      const res = await asSolo("GET", url);
      expect(res.statusCode, url).toBe(200);
      for (const p of hidden) expect(res.body, url).not.toContain(p.name);
    }
    // The rows stay, and stats still count them, as one hidden project.
    const stats = async (send: typeof asSolo) => (await send("GET", "/api/stats")).json();
    const [mine, all] = [await stats(asSolo), await stats(asAdmin)];
    expect(mine.totals).toEqual(all.totals);
    expect(mine.breakdowns.project).toContainEqual(
      expect.objectContaining({ key: HIDDEN_PROJECT, label: null }),
    );
    expect(all.breakdowns.project).toContainEqual(
      expect.objectContaining({ key: secret.id, label: `001-${secret.name}` }),
    );
    expect((await asSolo("GET", "/api/prints?pageSize=100")).json().total).toBe(
      (await asAdmin("GET", "/api/prints?pageSize=100")).json().total,
    );

    // Tags: hidden projects' taggings aren't listed, nor can they be changed.
    expect((await asSolo("GET", "/api/tags/taggings?entityType=project")).json()).toEqual([]);
    expect((await asAdmin("GET", "/api/tags/taggings?entityType=project")).json()).not.toEqual([]);
    expect(
      (await asSolo("PUT", `/api/tags/taggings/project/${secret.id}`, { tagIds: [] })).statusCode,
    ).toBe(404);
    // A collection: solo sees and sets only theirs; the hidden members stay, after them.
    expect((await asSolo("GET", `/api/collections/${desk.id}`)).json().projectIds).toEqual([]);
    const before = (await asAdmin("GET", `/api/collections/${desk.id}`)).json().projectIds;
    const set = (ids: string[]) =>
      asSolo("PUT", `/api/collections/${desk.id}/projects`, { projectIds: ids });
    expect((await set([secret.id])).statusCode).toBe(400);
    expect((await set([own.id])).json().projectIds).toEqual([own.id]);
    expect((await asAdmin("GET", `/api/collections/${desk.id}`)).json().projectIds).toEqual([
      own.id,
      ...before,
    ]);

    // The trash: only roots solo may edit count, and only those are emptied.
    const trash = join(dir, PROJECT_TRASH_DIR, "x_Secret");
    mkdirSync(trash, { recursive: true });
    writeFileSync(join(trash, "a.stl"), "solid");
    expect((await asSolo("GET", "/api/projects/trash")).json()).toEqual({ items: 1, bytes: 5 });
    await asAdmin("PATCH", `/api/roots/${root.id}`, { editBy: "admins" });
    expect((await asSolo("GET", "/api/projects/trash")).json()).toEqual({ items: 0, bytes: 0 });
    expect((await asSolo("DELETE", "/api/projects/trash")).statusCode).toBe(204);
    expect(existsSync(trash)).toBe(true);
    expect((await asAdmin("DELETE", "/api/projects/trash")).statusCode).toBe(204);
    expect(existsSync(trash)).toBe(false);
  });

  it("only an admin changes a project's owner, never in a device root", async () => {
    const { db, add, as } = await setup();
    const admin = add("admin", "admin");
    const solo = add("editor", "solo", { projectsSeeAll: false });
    const [asAdmin, asSolo] = await Promise.all([as(admin), as(solo)]);
    const p = (await asAdmin("POST", "/api/projects", { name: "Box" })).json();
    const owner = (send: typeof asAdmin, id: string, ownerId: string | null) =>
      send("PATCH", `/api/projects/${id}`, { ownerId });

    expect((await owner(asAdmin, p.id, crypto.randomUUID())).statusCode).toBe(400);
    expect((await owner(asAdmin, p.id, null)).json().ownerId).toBeNull();
    expect((await owner(asAdmin, p.id, solo.id)).json().ownerId).toBe(solo.id);
    // Now solo's: they see it, but can't hand it on.
    expect((await asSolo("GET", `/api/projects/${p.id}`)).json().owner.id).toBe(solo.id);
    expect((await owner(asSolo, p.id, admin.id)).statusCode).toBe(403);
    expect((await owner(asSolo, p.id, null)).statusCode).toBe(403);

    const dev = db
      .insert(schema.devices)
      .values({ name: "WS", userId: solo.id, tokenHash: "t" })
      .returning()
      .get();
    const devRoot = db
      .insert(schema.roots)
      .values({ name: "WS", location: dev.id, path: "C:/m", position: 1 })
      .returning()
      .get();
    db.update(schema.projects)
      .set({ rootId: devRoot.id, folder: "001_Box" })
      .where(eq(schema.projects.id, p.id))
      .run();
    expect((await owner(asAdmin, p.id, admin.id)).statusCode).toBe(409);
  });

  it("new users get the device right by role unless told", async () => {
    const { add, as } = await setup();
    const asAdmin = await as(add("admin", "admin"));
    const create = async (role: UserRole, rights = {}) =>
      (
        await asAdmin("POST", "/api/users", {
          email: `${role}${Object.keys(rights).length}@y.io`,
          displayName: role,
          password: PW,
          role,
          ...rights,
        })
      ).json();
    expect(await create("admin")).toMatchObject({ editOtherDevices: true, projectsSeeAll: true });
    expect(await create("editor")).toMatchObject({
      editOtherDevices: false,
      projectsEditOthers: true,
    });
    expect(await create("editor", { editOtherDevices: true, projectsSeeAll: false })).toMatchObject(
      {
        editOtherDevices: true,
        projectsSeeAll: false,
      },
    );
  });
});
