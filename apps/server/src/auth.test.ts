import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  ADMIN_EFFECTIVE,
  ALERT_KIND_CATALOG,
  ALERT_KINDS,
  type AlertKind,
  BUILT_IN_ROLE_IDS,
  type Capability,
  type EffectiveRights,
  effectiveRights,
  isAction,
  REVIEWED_TYPES,
  type RoleBuiltIn,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { buildApp } from "./app.ts";
import { can, loginLimiter, readDevice } from "./lib/auth.ts";
import { hashPassword } from "./lib/password.ts";
import { tokenHash } from "./lib/session.ts";

const PW = "password123";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PW);
});

type App = Awaited<ReturnType<typeof buildApp>>;
const setup = async (opts: Parameters<typeof buildApp>[3] = {}, dataDir = "") => {
  const db = openDb(":memory:");
  const out: string[] = [];
  const app = await buildApp(db, { stream: { write: (l: string) => out.push(l) } }, dataDir, opts);
  return { db, app, out };
};
const addUser = (db: ReturnType<typeof openDb>, role: RoleBuiltIn, email = `${role}@x.io`) =>
  db
    .insert(schema.users)
    .values({ email, displayName: role, roleId: BUILT_IN_ROLE_IDS[role], passwordHash: hash })
    .returning()
    .get();
type UserRole = RoleBuiltIn;
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(res.headers["set-cookie"] ?? "").split(";")[0] ?? "";
const login = async (app: App, email: string, password = PW) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
const as = (app: App, cookie: string) => ({
  get: (url: string) => app.inject({ url, headers: { cookie } }),
  send: (method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } }),
});

// ADR-0012, written out again so a change to lib/auth.ts has to change this too. Admin: always RW.
// ADR-0016: the seeded roles answer exactly this, as before the migration.
const MATRIX: Record<string, [viewer: string, editor: string]> = {
  "/api/auth/me": ["RW", "RW"],
  "/api/printers": ["R", "R"],
  "/api/accessories": ["R", "R"],
  "/api/maintenance": ["R", "R"],
  "/api/brands": ["R", "R"],
  "/api/printer-models": ["R", "R"],
  "/api/machine-presets": ["R", "R"],
  "/api/filament": ["R", "RW"],
  "/api/filament-brands": ["R", "R"],
  "/api/filament-materials": ["R", "R"],
  "/api/process-presets": ["R", "R"],
  "/api/projects": ["R", "RW"],
  "/api/roots": ["R", "R"],
  "/api/prints": ["R", "RW"],
  "/api/costs": ["R", "RW"],
  "/api/orders": ["R", "RW"],
  "/api/clients": ["R", "RW"],
  "/api/accessories/abc/installs": ["R", "RW"],
  "/api/maintenance/tasks": ["R", "RW"],
  "/api/maintenance/types": ["R", "R"],
  "/api/filament/presets": ["R", "R"],
  "/api/stats": ["R", "R"],
  "/api/tags": ["R", "RW"],
  // Manage on the item's module, which neither seeded role has on costs.
  "/api/bulk/clients": ["-", "-"],
  "/api/collections": ["R", "RW"],
  "/api/alerts": ["R", "RW"],
  "/api/alerts/channels": ["-", "-"],
  "/api/alerts/coverage": ["-", "-"],
  "/api/preferences": ["RW", "RW"],
  "/api/branding": ["R", "R"],
  "/api/branding/logo": ["R", "R"],
  "/api/backups/restore": ["-", "-"],
  "/api/backups/x/restore": ["-", "-"],
  "/api/logs/clear": ["-", "-"],
  "/api/server-config/stop": ["-", "-"],
  "/api/server-config/autostart": ["-", "-"],
  "/api/integrations": ["R", "R"],
  "/api/integrations/abc/sync": ["R", "RW"],
  "/api/slicer-zip": ["-", "-"],
  "/api/import": ["-", "-"],
  // Opened for editors, then narrowed per task by `mayTask` (the flags test below).
  "/api/import/integration/abc/printers": ["-", "W"],
  "/api/import/printers/apply": ["-", "W"],
  "/api/import/printers/preview": ["-", "-"],
  "/api/backups": ["-", "-"],
  "/api/logs": ["-", "-"],
  "/api/fs": ["-", "-"],
  "/api/fs/list": ["-", "R"],
  "/api/fs/folder": ["-", "W"],
  "/api/server-config": ["-", "-"],
  "/api/updates": ["-", "-"],
  "/api/users": ["-", "-"],
  "/api/roles": ["-", "-"],
  // ADR-0021: anyone lists their own machines (the route narrows it); the rest is hub.manage.
  "/api/hub/devices": ["R", "R"],
  "/api/hub/devices/abc/user-code": ["-", "-"],
  "/api/hub/pairing-codes": ["-", "-"],
  // ADR-0017, ADR-0021: who sees projects sees the presets; presets write (Editor by 0111) deletes.
  "/api/presets": ["R", "RW"],
  "/api/presets/abc": ["R", "RW"],
  "/api/presets/devices": ["-", "RW"],
  // ADR-0020: Sources settings and the catalog source are catalog manage (Admin by 0103).
  "/api/catalog/sources": ["R", "R"],
  "/api/docs": ["-", "-"],
  "/api/not-yet-in-the-table": ["-", "-"],
};

/** The effective rights of the roles a fresh database seeds (migration 0086). */
let seeded: Record<RoleBuiltIn, EffectiveRights>;
beforeAll(() => {
  const rows = openDb(":memory:").select().from(schema.roles).all();
  seeded = Object.fromEntries(rows.map((r) => [r.builtIn, effectiveRights(r)])) as typeof seeded;
});

describe("permissions", () => {
  it("every prefix × seeded role × read/write matches ADR-0012", () => {
    for (const [url, [viewer, editor]] of Object.entries(MATRIX))
      for (const [role, access] of [
        ["viewer", viewer],
        ["editor", editor],
        ["admin", "RW"],
      ] as const) {
        const r = seeded[role];
        const got = `${can(r, url, "GET") ? "R" : ""}${can(r, url, "POST") ? "W" : ""}`;
        expect(`${role} ${url} ${got || "-"}`).toBe(`${role} ${url} ${access}`);
      }
  });

  it("a viewer may PATCH their alert state, nothing else under /alerts", () => {
    const { viewer, editor } = seeded;
    expect(can(viewer, "/api/alerts/abc", "PATCH")).toBe(true);
    expect(can(viewer, "/api/alerts/evaluate", "POST")).toBe(false);
    expect(can(viewer, "/api/alerts/channels/ntfy", "PATCH")).toBe(false);
    expect(can(viewer, "/api/alerts/channels/ntfy", "PUT")).toBe(false);
    expect(can(editor, "/api/alerts/channels/ntfy", "PATCH")).toBe(false);
  });

  it("module levels, switches and the tagged module, beyond the seeded roles", () => {
    const rights = (permissions: Partial<EffectiveRights["permissions"]>) =>
      effectiveRights({ builtIn: null, permissions });
    const helper = rights({ filament: "manage", "settings.backup": true });
    expect(can(helper, "/api/filament/spools", "POST")).toBe(true);
    expect(can(helper, "/api/bulk/spools", "POST")).toBe(true);
    expect(can(helper, "/api/printers", "GET")).toBe(false);
    expect(can(helper, "/api/backups", "POST")).toBe(true);
    // Restore stays with the Admin role: a restored database carries anyone's rights.
    expect(can(helper, "/api/backups/x/restore", "POST")).toBe(false);
    expect(can(helper, "/api/tags/taggings/spool/abc", "PUT")).toBe(true);
    expect(can(helper, "/api/tags/taggings/print/abc", "PUT")).toBe(false);
    expect(can(helper, "/api/tags", "POST")).toBe(true); // any write permission
    expect(can(rights({ prints: "read" }), "/api/tags", "POST")).toBe(false);
    const roots = rights({ projects: "manage" });
    expect(can(roots, "/api/users", "GET")).toBe(true);
    expect(can(roots, "/api/users", "POST")).toBe(false);
    expect(can(roots, "/api/fs", "GET")).toBe(true);
    const hub = rights({ "hub.manage": true });
    expect(can(hub, "/api/hub/devices", "GET")).toBe(true);
    expect(can(hub, "/api/not-yet-in-the-table", "GET")).toBe(false);
  });

  it("catalog (ADR-0020): pickers read with printers or filament, edits need catalog manage", () => {
    const rights = (permissions: Partial<EffectiveRights["permissions"]>) =>
      effectiveRights({ builtIn: null, permissions });
    const modules = rights({ printers: "manage", filament: "manage" });
    for (const url of ["/api/brands", "/api/filament-materials"]) {
      expect(can(rights({ filament: "read" }), url, "GET")).toBe(true);
      expect(can(rights({ catalog: "read" }), url, "GET")).toBe(true);
      expect(can(modules, url, "POST")).toBe(false);
    }
    expect(can(modules, "/api/bulk/brands", "POST")).toBe(false);
    expect(can(modules, "/api/integrations/abc", "PATCH")).toBe(false);

    const manage = rights({ catalog: "manage" });
    expect(can(manage, "/api/brands", "POST")).toBe(true);
    // Presets are the catalog's too (ADR-0023).
    expect(can(manage, "/api/filament/presets/abc", "DELETE")).toBe(true);
    expect(can(manage, "/api/machine-presets", "GET")).toBe(true);
    expect(can(manage, "/api/bulk/filament-materials", "POST")).toBe(true);
    expect(can(manage, "/api/filament/spools", "GET")).toBe(false);
    expect(can(manage, "/api/printers", "GET")).toBe(false);
    // The route narrows it to the catalog cards (the next test).
    expect(can(manage, "/api/integrations/abc", "PATCH")).toBe(true);
    expect(can(manage, "/api/integrations/abc", "DELETE")).toBe(false);

    const write = rights({ catalog: "write" });
    expect(can(write, "/api/presets/abc", "DELETE")).toBe(true);
    expect(can(write, "/api/brands", "POST")).toBe(false);
    // The hub's slicer is picked in Integrations (ADR-0022).
    expect(can(manage, "/api/integrations/slicers/bambu-studio", "PUT")).toBe(false);
    expect(
      can(rights({ "integrations.manage": true }), "/api/integrations/slicers/bambu-studio", "PUT"),
    ).toBe(true);
    // Choose brands is a Sources setting; the rest of import stays integrations.manage.
    expect(can(write, "/api/import/catalog/abc", "POST")).toBe(false);
    expect(can(manage, "/api/import/catalog/abc", "GET")).toBe(true);
    expect(can(manage, "/api/import/catalog/abc", "POST")).toBe(true);
    expect(can(manage, "/api/import/printers/preview", "POST")).toBe(false);
    expect(can(manage, "/api/slicer-zip/orca-slicer", "POST")).toBe(false);
  });

  it("presets (ADR-0021, ADR-0023): the preset tables, the library and the device switches are catalog's", () => {
    const rights = (permissions: Partial<EffectiveRights["permissions"]>) =>
      effectiveRights({ builtIn: null, permissions });
    const read = rights({ catalog: "read" });
    for (const url of ["/api/machine-presets", "/api/process-presets", "/api/filament/presets"]) {
      expect(can(read, url, "GET")).toBe(true);
      expect(can(read, `${url}/abc`, "DELETE")).toBe(false);
      expect(can(rights({ catalog: "manage" }), `${url}/abc`, "DELETE")).toBe(true);
    }
    expect(can(read, "/api/filament/spools", "GET")).toBe(false);
    expect(can(read, "/api/presets", "GET")).toBe(true);
    expect(can(read, "/api/presets/abc", "DELETE")).toBe(false);
    expect(can(read, "/api/presets/devices", "GET")).toBe(false);
    expect(can(read, "/api/catalog/sources", "GET")).toBe(true);
    const write = rights({ catalog: "write" });
    expect(can(write, "/api/presets/abc", "DELETE")).toBe(true);
    expect(can(write, "/api/presets/devices/abc/held", "POST")).toBe(true);
    expect(can(write, "/api/machine-presets/abc", "DELETE")).toBe(false);
    expect(can(rights({ catalog: "manage" }), "/api/bulk/machine-presets", "POST")).toBe(true);
  });

  it("integration PATCH: catalog and preset cards need catalog manage, the rest integrations.manage", async () => {
    const { db, app } = await setup({ adapters: [mockAdapter(fixture())] });
    addUser(db, "admin");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    const { id } = (
      await admin.send("POST", "/api/integrations", { adapterId: "mock", secrets: { token: "t" } })
    ).json();
    const session = async (name: string, permissions: object) => {
      const role = (await admin.send("POST", "/api/roles", { name, permissions })).json();
      const email = `${name}@x.io`;
      await admin.send("POST", "/api/users", {
        email,
        displayName: name,
        password: PW,
        roleId: role.id,
      });
      return as(app, cookieOf(await login(app, email)));
    };
    const catalog = await session("catalog", { catalog: "manage" });
    const integrations = await session("integrations", { "integrations.manage": true });
    const patch = async (who: typeof admin, body: object) =>
      (await who.send("PATCH", `/api/integrations/${id}`, body)).statusCode;
    const brands = { policies: [{ type: "brands", mode: "manual" }] };
    const printers = { policies: [{ type: "printers", mode: "manual" }] };
    // Past the rights: the mock has no brands card.
    const machinePresets = { policies: [{ type: "machinePresets", mode: "manual" }] };
    expect(await patch(catalog, brands)).toBe(400);
    expect(await patch(catalog, machinePresets)).toBe(400);
    expect(await patch(catalog, printers)).toBe(403);
    expect(await patch(catalog, { enabled: true })).toBe(403);
    expect(await patch(integrations, brands)).toBe(403);
    expect(await patch(integrations, printers)).toBe(200);
    expect(await patch(admin, brands)).toBe(400);
  });

  it("every registered prefix is in the matrix", async () => {
    const { app } = await setup();
    const spec = (await app.inject("/api/docs/json")).json();
    const covered = new Set(Object.keys(MATRIX).map((u) => u.split("/")[2]));
    const prefixes = new Set(Object.keys(spec.paths).map((p) => p.split("/")[2]));
    prefixes.delete("health"); // public
    expect(prefixes.size).toBeGreaterThan(25);
    expect([...prefixes].filter((p) => !covered.has(p))).toEqual([]);
  });

  it("the hook enforces sessions and roles once users exist", async () => {
    const { db, app } = await setup();
    // No users: today's behaviour.
    expect((await app.inject("/api/printers")).statusCode).toBe(200);
    expect((await app.inject("/api/auth/me")).json()).toEqual({
      user: null,
      role: null,
      ...ADMIN_EFFECTIVE,
    });

    for (const role of ["admin", "editor", "viewer"] as const) addUser(db, role);
    expect((await app.inject("/api/printers")).statusCode).toBe(401);
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect((await app.inject("/some/spa/route")).statusCode).toBe(404); // public, no SPA in tests

    const viewer = as(app, cookieOf(await login(app, "viewer@x.io")));
    const me = (await viewer.get("/api/auth/me")).json();
    expect(me.role).toMatchObject({ name: "Viewer", builtIn: "viewer" });
    expect(me).toMatchObject({
      admin: false,
      permissions: { prints: "read", "users.manage": false },
    });
    expect((await viewer.get("/api/printers")).statusCode).toBe(200);
    const denied = await viewer.send("POST", "/api/clients", { name: "Ana", mobile: "1" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("forbidden");

    const editor = as(app, cookieOf(await login(app, "editor@x.io")));
    expect(
      (await editor.send("POST", "/api/clients", { name: "Ana", mobile: "1" })).statusCode,
    ).toBe(201);
    expect((await editor.get("/api/backups")).statusCode).toBe(403);
    // The folder picker: editors see the project roots (none yet) and nothing else.
    expect((await editor.get("/api/fs/list")).json().entries).toEqual([]);
    expect(
      (await editor.send("POST", "/api/fs/folder", { path: process.cwd(), name: "x" })).statusCode,
    ).toBe(403);
    expect(
      (await editor.get(`/api/fs/list?path=${encodeURIComponent(process.cwd())}`)).statusCode,
    ).toBe(403);
    expect((await editor.get("/api/alerts/channels")).statusCode).toBe(403);

    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    expect((await admin.get("/api/users")).statusCode).toBe(200);

    expect((await viewer.send("POST", "/api/auth/logout")).statusCode).toBe(204);
    expect((await viewer.get("/api/printers")).statusCode).toBe(401);
  });

  it("alerts: read, snooze and dismiss are per user; resolving is for everyone", async () => {
    const { db, app } = await setup();
    for (const role of ["admin", "editor", "viewer"] as const) addUser(db, role);
    const session = async (r: UserRole) => as(app, cookieOf(await login(app, `${r}@x.io`)));
    const [admin, editor, viewer] = [
      await session("admin"),
      await session("editor"),
      await session("viewer"),
    ];
    const raise = (v: Partial<typeof schema.alerts.$inferInsert> = {}) =>
      db
        .insert(schema.alerts)
        .values({
          kind: "spool_low",
          severity: "warning",
          module: "filament",
          task: "spool:gone",
          entityType: "spool",
          entityId: crypto.randomUUID(),
          ...v,
        })
        .returning()
        .get().id;
    // Read before accounts existed: everyone without a row of their own sees it read.
    const legacyRead = "2026-01-01T00:00:00.000Z";
    // An event every seeded role gets (ADR-0016: a hub conflict outside a project needs projects read).
    const old = raise({ kind: "hub_conflict", severity: "success", readAt: legacyRead });
    // A condition nothing holds any more: the next check resolves it.
    const low = raise();
    const act = (s: typeof admin, id: string, body: object) =>
      s.send("PATCH", `/api/alerts/${id}`, body);
    const get = async (s: typeof admin, id: string) => (await s.get(`/api/alerts/${id}`)).json();
    const listed = async (s: typeof admin) =>
      (await s.get("/api/alerts")).json().map((a: { id: string }) => a.id);

    expect((await act(viewer, low, { action: "read" })).json().readAt).not.toBeNull();
    expect((await get(admin, low)).readAt).toBeNull();
    expect((await act(viewer, low, { action: "dismiss" })).statusCode).toBe(200);
    expect(await listed(viewer)).not.toContain(low);
    expect(await listed(admin)).toContain(low);
    expect((await viewer.send("POST", "/api/alerts/evaluate")).statusCode).toBe(403);

    expect((await get(admin, old)).readAt).toBe(legacyRead);
    expect((await act(admin, old, { action: "unread" })).json().readAt).toBeNull();
    expect((await get(editor, old)).readAt).toBe(legacyRead);

    // A snooze that ended comes back unread, for that user only.
    await act(admin, old, { action: "snooze", days: 1 });
    db.update(schema.alertStates).set({ snoozedUntil: legacyRead }).run();
    expect((await editor.send("POST", "/api/alerts/evaluate")).statusCode).toBe(204);
    expect(await get(admin, old)).toMatchObject({ readAt: null, snoozedUntil: null });
    expect((await get(editor, old)).readAt).toBe(legacyRead);

    // The same check resolved `low`: gone for everyone and counted as read.
    for (const s of [admin, editor, viewer]) {
      const a = await get(s, low);
      expect(a.resolvedAt).not.toBeNull();
      expect(a.readAt).not.toBeNull();
      expect(await listed(s)).not.toContain(low);
      const history = (await s.get("/api/alerts/history?status=resolved")).json().items;
      expect(history.map((h: { id: string }) => h.id)).toContain(low);
    }
  });

  it("editor flags: sync and review per task, both off by default; never the setup fields", async () => {
    // An apply takes a backup first.
    const dataDir = mkdtempSync(join(tmpdir(), "auth-"));
    onTestFinished(() => rmSync(dataDir, { recursive: true, force: true }));
    const { db, app } = await setup({ adapters: [mockAdapter(fixture())] }, dataDir);
    for (const role of ["admin", "editor", "viewer"] as const) addUser(db, role);
    const session = async (r: UserRole) => as(app, cookieOf(await login(app, `${r}@x.io`)));
    const [admin, editor, viewer] = [
      await session("admin"),
      await session("editor"),
      await session("viewer"),
    ];
    type Who = typeof admin;
    const { id } = (
      await admin.send("POST", "/api/integrations", { adapterId: "mock", secrets: { token: "t" } })
    ).json();
    const types: Capability[] = (await admin.get("/api/integrations/adapters"))
      .json()[0]
      .capabilities.filter((c: Capability) => !isAction(c));
    expect(types.length).toBeGreaterThan(0);
    const sync = (who: Who, type: string) =>
      who.send("POST", `/api/integrations/${id}/sync`, { type });
    const review = (who: Who, type: string) =>
      who.send("POST", `/api/import/integration/${id}/${type}`);
    const denied = async (r: ReturnType<Who["send"]>) => (await r).statusCode === 403;
    const reviewed = (t: Capability) => (REVIEWED_TYPES as readonly string[]).includes(t);

    const got: string[] = [];
    const want: string[] = [];
    for (const type of types)
      for (const [editorSync, editorReview] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ] as [boolean, boolean][]) {
        if (editorSync || editorReview)
          await admin.send("PATCH", `/api/integrations/${id}`, {
            policies: [{ type, editorSync, editorReview }],
          });
        const at = `${type} sync=${editorSync} review=${editorReview}`;
        const row = async (who: string, s: Who) =>
          `${at} ${who}: sync ${(await denied(sync(s, type))) ? 403 : "ok"}${
            reviewed(type) ? `, review ${(await denied(review(s, type))) ? 403 : "ok"}` : ""
          }`;
        const line = (who: string, s: boolean, r: boolean) =>
          `${at} ${who}: sync ${s ? "ok" : 403}${reviewed(type) ? `, review ${r ? "ok" : 403}` : ""}`;
        for (const [who, s] of [
          ["admin", admin],
          ["editor", editor],
          ["viewer", viewer],
        ] as const)
          got.push(await row(who, s));
        want.push(
          line("admin", true, true),
          line("editor", editorSync, editorReview),
          line("viewer", false, false),
        );
      }
    expect(got).toEqual(want);

    // Apply: an integration's review with the flag; never a file import.
    const prints = "prints";
    await admin.send("PATCH", `/api/integrations/${id}`, {
      policies: [{ type: prints, editorReview: true }],
    });
    const apply = async (who: Who, uploadId: string) =>
      (
        await who.send("POST", `/api/import/${prints}/apply`, {
          uploadId,
          policy: "keepEdits",
          decisions: [],
        })
      ).statusCode;
    const offered = (await review(editor, prints)).json().uploadId;
    await admin.send("PATCH", `/api/integrations/${id}`, {
      policies: [{ type: prints, editorReview: false }],
    });
    expect(await apply(editor, offered)).toBe(403);
    await admin.send("PATCH", `/api/integrations/${id}`, {
      policies: [{ type: prints, editorReview: true }],
    });
    expect(await apply(editor, offered)).toBe(200);
    const file = (
      await admin.send("POST", "/api/import/clients/preview", [{ name: "Ana", mobile: "1" }])
    ).json().uploadId;
    expect(
      (
        await editor.send("POST", "/api/import/clients/apply", {
          uploadId: file,
          policy: "keepEdits",
          decisions: [{ row: 2, action: "create" }],
        })
      ).statusCode,
    ).toBe(403);
    expect(await apply(viewer, offered)).toBe(403);

    // Admins see the setup; nobody else does.
    const SETUP = ["config", "hasSecrets", "slicerConfigDir", "slicerPath"];
    const [full] = (await admin.get("/api/integrations")).json();
    expect(Object.keys(full)).toEqual(expect.arrayContaining(SETUP));
    for (const who of [editor, viewer])
      for (const i of [
        (await who.get("/api/integrations")).json()[0],
        (await who.get(`/api/integrations/${id}`)).json(),
      ]) {
        expect(Object.keys(i).filter((k) => SETUP.includes(k))).toEqual([]);
        expect(i.policies[0]).toHaveProperty("editorSync");
      }
  });

  it("preferences: own display keys for everyone, the rest by permission", async () => {
    const { db, app } = await setup();
    for (const role of ["admin", "editor", "viewer"] as const) addUser(db, role);
    const session = async (r: UserRole) => as(app, cookieOf(await login(app, `${r}@x.io`)));
    const [admin, editor, viewer] = [
      await session("admin"),
      await session("editor"),
      await session("viewer"),
    ];
    type Who = typeof admin;
    const patch = (who: Who, payload: object) => who.send("PATCH", "/api/preferences", payload);
    const userId = (r: string) =>
      db
        .select()
        .from(schema.users)
        .all()
        .find((u) => u.email === `${r}@x.io`)?.id;
    const values = async (who: Who) => (await who.get("/api/preferences")).json().values;

    expect((await patch(viewer, { themeMode: "dark" })).statusCode).toBe(200);
    expect((await values(viewer)).themeMode).toBe("dark");
    expect((await values(admin)).themeMode).toBe("system"); // global value, untouched
    // All or nothing.
    expect((await patch(viewer, { themeMode: "light", currency: "USD" })).statusCode).toBe(403);
    expect((await values(viewer)).themeMode).toBe("dark");

    expect((await patch(editor, { accent: "rose" })).statusCode).toBe(200);
    expect((await patch(editor, { currency: "USD" })).statusCode).toBe(403);
    expect((await patch(editor, { appName: "Shop" })).statusCode).toBe(403);
    expect((await patch(admin, { appName: "Shop" })).statusCode).toBe(200);
    // Costs manage opens the cost keys, and only those.
    const costs = (
      await admin.send("POST", "/api/roles", { name: "Quoting", permissions: { costs: "manage" } })
    ).json();
    await admin.send("PATCH", `/api/users/${userId("editor")}`, { roleId: costs.id });
    expect((await patch(editor, { currency: "USD", markupPct: 10 })).statusCode).toBe(200);
    expect((await patch(editor, { currency: "EUR", backupKeep: 3 })).statusCode).toBe(403);
  });
});

describe("users", () => {
  it("setup: loopback, APP_PASSWORD or the boot token; only once", async () => {
    const { app } = await setup({ setupToken: "tok" });
    const body = { email: "Me@X.io", displayName: "Me", password: PW };
    const post = (payload: object, remoteAddress = "192.168.1.9") =>
      app.inject({ method: "POST", url: "/api/auth/setup", payload, remoteAddress });
    expect((await post(body)).statusCode).toBe(403);
    expect((await post({ ...body, token: "nope" })).statusCode).toBe(403);
    const ok = await post({ ...body, token: "tok" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({
      user: { email: "me@x.io", roleId: BUILT_IN_ROLE_IDS.admin },
      role: { builtIn: "admin" },
      admin: true,
    });
    expect((await as(app, cookieOf(ok)).get("/api/users")).statusCode).toBe(200);
    expect((await post(body, "127.0.0.1")).json().error.code).toBe("setup_done");

    const local = await setup();
    const res = await local.app.inject({ method: "POST", url: "/api/auth/setup", payload: body });
    expect(res.statusCode).toBe(201);
  });

  it("setup through a reverse proxy: an allowed host is not 'this PC', so it needs the token", async () => {
    const { app } = await setup({
      setupToken: "tok",
      access: { host: "127.0.0.1", allowedHosts: ["example.test"] },
    });
    const payload = { email: "me@x.io", displayName: "Me", password: PW };
    const post = (extra: object, host: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/setup",
        payload: { ...payload, ...extra },
        remoteAddress: "127.0.0.1",
        headers: { host },
      });
    const denied = await post({}, "example.test");
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("setup_token");
    expect((await post({ token: "tok" }, "example.test")).statusCode).toBe(201);
  });

  it("the last enabled admin can't be deleted; nobody changes their own role or state", async () => {
    const { db, app } = await setup();
    const me = addUser(db, "admin");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    const url = `/api/users/${me.id}`;
    for (const payload of [{ roleId: BUILT_IN_ROLE_IDS.editor }, { disabled: true }])
      expect((await admin.send("PATCH", url, payload)).json().error.code).toBe("own_account");
    // Sending your own values back is no change.
    expect(
      (await admin.send("PATCH", url, { disabled: false, displayName: "Me" })).statusCode,
    ).toBe(200);
    expect((await admin.send("DELETE", url)).json().error.code).toBe("last_admin");

    const other = await admin.send("POST", "/api/users", {
      email: "two@x.io",
      displayName: "Two",
      password: PW,
      roleId: BUILT_IN_ROLE_IDS.admin,
    });
    expect(other.statusCode).toBe(201);
    const two = as(app, cookieOf(await login(app, "two@x.io")));
    expect((await two.send("PATCH", url, { roleId: BUILT_IN_ROLE_IDS.editor })).statusCode).toBe(
      200,
    );
    // Rights are read per request: the session goes on, with the editor's rights.
    expect((await admin.get("/api/auth/me")).json().role.builtIn).toBe("editor");
    expect((await admin.get("/api/users")).statusCode).toBe(403);
    // Now `two` is the last enabled admin, and can't be demoted by anyone.
    const id = other.json().id;
    expect((await admin.send("PATCH", `/api/users/${id}`, { disabled: true })).statusCode).toBe(
      403,
    );
  });

  it("disabling or a reset ends the user's sessions; a role or override change doesn't", async () => {
    const { db, app } = await setup();
    addUser(db, "admin");
    const viewer = addUser(db, "viewer");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    const url = `/api/users/${viewer.id}`;
    for (const [change, undo, ends] of [
      [{ disabled: true }, { disabled: false }, true],
      [{ password: "a new one!" }, { password: PW }, true],
      [{ roleId: BUILT_IN_ROLE_IDS.editor }, { roleId: BUILT_IN_ROLE_IDS.viewer }, false],
      [{ permissions: { prints: "write" } }, { permissions: {} }, false],
    ] as const) {
      const session = as(app, cookieOf(await login(app, "viewer@x.io")));
      expect((await session.get("/api/auth/me")).statusCode).toBe(200);
      expect((await admin.send("PATCH", url, change)).statusCode).toBe(200);
      expect((await session.get("/api/auth/me")).statusCode).toBe(ends ? 401 : 200);
      await admin.send("PATCH", url, undo);
    }
    await admin.send("PATCH", url, { disabled: true });
    expect((await login(app, "viewer@x.io")).json().error.code).toBe("user_disabled");
  });

  it("changing your own password needs the current one", async () => {
    const { db, app } = await setup();
    addUser(db, "viewer");
    const viewer = as(app, cookieOf(await login(app, "viewer@x.io")));
    const wrong = { currentPassword: "nope", password: "brand new pw" };
    expect((await viewer.send("PATCH", "/api/auth/me", wrong)).statusCode).toBe(403);
    expect(
      (await viewer.send("PATCH", "/api/auth/me", { password: "brand new pw" })).statusCode,
    ).toBe(400);
    const ok = await viewer.send("PATCH", "/api/auth/me", { ...wrong, currentPassword: PW });
    expect(ok.statusCode).toBe(200);
    expect((await as(app, cookieOf(ok)).get("/api/auth/me")).statusCode).toBe(200);
    expect((await login(app, "viewer@x.io", "brand new pw")).statusCode).toBe(200);
  });

  it("you set your own alert kinds; a kind you lack the permission for stays out of your list", async () => {
    const { db, app } = await setup();
    addUser(db, "viewer");
    const viewer = as(app, cookieOf(await login(app, "viewer@x.io")));
    const set = await viewer.send("PATCH", "/api/auth/me", {
      alertKinds: { spool_low: "notify", sync_error: "off" },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().user.alertKinds).toEqual({ spool_low: "notify", sync_error: "off" });
    expect(set.json().role.alertKinds).toBeDefined();
    expect((await viewer.get("/api/auth/me")).json().user.alertKinds).toEqual({
      spool_low: "notify",
      sync_error: "off",
    });
    // An empty object goes back to the role; an unknown kind is refused.
    expect(
      (await viewer.send("PATCH", "/api/auth/me", { alertKinds: {} })).json().user.alertKinds,
    ).toEqual({});
    expect(
      (await viewer.send("PATCH", "/api/auth/me", { alertKinds: { nope: "off" } })).statusCode,
    ).toBe(400);
  });

  it("no response ever carries a hash", async () => {
    const { db, app } = await setup();
    const responses = [
      await app.inject({
        method: "POST",
        url: "/api/auth/setup",
        payload: { email: "a@x.io", displayName: "A", password: PW },
      }),
    ];
    const admin = as(app, cookieOf(responses[0] as never));
    responses.push(await admin.get("/api/auth/me"));
    const created = await admin.send("POST", "/api/users", {
      email: "b@x.io",
      displayName: "B",
      password: PW,
      roleId: BUILT_IN_ROLE_IDS.viewer,
    });
    responses.push(
      created,
      await admin.get("/api/users"),
      await admin.send("PATCH", `/api/users/${created.json().id}`, { password: "another pw" }),
      await admin.send("PATCH", "/api/auth/me", { displayName: "Ay" }),
      await login(app, "a@x.io"),
    );
    expect(db.select().from(schema.users).all()).toHaveLength(2);
    for (const r of responses) expect(r.body).not.toMatch(/scrypt|passwordHash/);
  });

  it("login is rate limited per email + IP; a wrong password says which neither", async () => {
    const { db, app } = await setup();
    addUser(db, "viewer");
    const wrong = await login(app, "viewer@x.io", "wrong");
    expect(wrong.json().error).toEqual({
      code: "invalid_credentials",
      message: "Wrong email or password",
    });
    expect((await login(app, "nobody@x.io")).json().error.code).toBe("invalid_credentials");
    for (let i = 0; i < 4; i++) await login(app, "viewer@x.io", "wrong");
    expect((await login(app, "viewer@x.io")).statusCode).toBe(429);
    const elsewhere = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "viewer@x.io", password: PW },
      remoteAddress: "10.0.0.2",
    });
    expect(elsewhere.statusCode).toBe(200);

    let t = 0;
    const limit = loginLimiter(() => t);
    for (let i = 0; i < 5; i++) limit.fail("k");
    expect(limit.locked("k")).toBe(true);
    t += 15 * 60_000;
    expect(limit.locked("k")).toBe(false);
  });

  it("request log lines carry the actor", async () => {
    const { db, app } = await setup();
    const user = addUser(db, "admin");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    await admin.send("PATCH", "/api/preferences", { logActive: true });
    await admin.send("POST", "/api/clients", { name: "Ana", mobile: "1" });
    const rows = db.select().from(schema.logs).all();
    expect(rows.find((r) => r.message === "POST /api/clients 201")?.actor).toBe(user.id);
  });

  it("the hook keeps the host guard for loopback binds", async () => {
    const { db, app } = await setup({ access: { host: "127.0.0.1" } });
    addUser(db, "admin");
    const res = await app.inject({ url: "/api/health", headers: { host: "evil.example" } });
    expect(res.statusCode).toBe(403);
    const lan = await setup({ access: { host: "0.0.0.0", password: "pw" } });
    addUser(lan.db, "admin");
    // APP_PASSWORD is ignored: no Basic challenge, a session is needed.
    const r = await lan.app.inject({ url: "/api/printers", headers: { host: "nas.lan" } });
    expect(r.statusCode).toBe(401);
    expect(r.headers["www-authenticate"]).toBeUndefined();
  });
});

describe("accounts switch", () => {
  it("off takes the no-users path; on asks for a login again; users and roles stay", async () => {
    const { db, app } = await setup({ access: { host: "0.0.0.0", password: "pw" } });
    addUser(db, "admin");
    const basic = { authorization: `Basic ${Buffer.from("x:pw").toString("base64")}` };
    const cookie = cookieOf(await login(app, "admin@x.io"));
    const get = (url: string, headers: Record<string, string> = {}) =>
      app.inject({ url, headers: { host: "nas.lan", ...headers } });
    const patch = (payload: object, headers: Record<string, string>) =>
      app.inject({ method: "PATCH", url: "/api/preferences", payload, headers });

    expect((await get("/api/printers", basic)).statusCode).toBe(401); // a session is needed
    expect((await patch({ accountsEnabled: false }, { cookie })).statusCode).toBe(200);
    // Off: APP_PASSWORD guards again, and nobody is signed in.
    expect((await get("/api/printers")).statusCode).toBe(401);
    expect((await get("/api/printers", basic)).statusCode).toBe(200);
    expect((await get("/api/auth/me", { ...basic, cookie })).json().user).toBeNull();
    const roles = db.select().from(schema.roles).all().length;

    expect((await patch({ accountsEnabled: true }, basic)).statusCode).toBe(200);
    expect((await get("/api/printers", { cookie })).statusCode).toBe(401); // the old session ended
    const again = cookieOf(await login(app, "admin@x.io"));
    expect((await get("/api/auth/me", { cookie: again })).json().user.email).toBe("admin@x.io");
    expect(db.select().from(schema.users).all()).toHaveLength(1);
    expect(db.select().from(schema.roles).all()).toHaveLength(roles);
  });

  it("blocks the hub, and the hub blocks it", async () => {
    const { db, app } = await setup();
    addUser(db, "admin");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    const patch = (body: object) => admin.send("PATCH", "/api/preferences", body);
    const code = async (body: object) => (await patch(body)).json().error?.code;

    expect((await patch({ hubEnabled: true })).statusCode).toBe(200);
    expect(await code({ accountsEnabled: false })).toBe("hub_needs_users");
    expect((await patch({ hubEnabled: false, accountsEnabled: false })).statusCode).toBe(200);
    // Now in the no-users mode: no cookie needed, and the hub can't come on.
    const anon = (payload: object) =>
      app.inject({ method: "PATCH", url: "/api/preferences", payload });
    expect((await anon({ hubEnabled: true })).json().error.code).toBe("hub_needs_users");
    expect((await anon({ accountsEnabled: true, hubEnabled: true })).statusCode).toBe(200);
  });
});

describe("roles and overrides (ADR-0016)", () => {
  const start = async () => {
    const { db, app } = await setup();
    addUser(db, "admin");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    const role = async (name: string, body: object = {}) =>
      (await admin.send("POST", "/api/roles", { name, ...body })).json();
    const user = async (email: string, roleId: string, body: object = {}) => {
      const res = await admin.send("POST", "/api/users", {
        email,
        displayName: email,
        password: PW,
        roleId,
        ...body,
      });
      expect(res.statusCode).toBe(201);
      return { id: res.json().id as string, s: as(app, cookieOf(await login(app, email))) };
    };
    return { db, app, admin, role, user };
  };

  it("a custom role and a user override change what the user may do, on the next request", async () => {
    const { admin, role, user } = await start();
    const helper = await role("Filament helper", {
      permissions: { filament: "manage", catalog: "manage" },
    });
    expect(helper).toMatchObject({ usersCount: 0, builtIn: null });
    expect(helper.permissions).toMatchObject({ filament: "manage", printers: "none" });
    const h = await user("h@x.io", helper.id);
    expect((await h.s.get("/api/filament/spools")).statusCode).toBe(200);
    expect((await h.s.send("POST", "/api/filament-brands", {})).statusCode).not.toBe(403);
    // An override takes the catalog edits away again (ADR-0020).
    await admin.send("PATCH", `/api/users/${h.id}`, { permissions: { catalog: "read" } });
    expect((await h.s.send("POST", "/api/filament-brands", {})).statusCode).toBe(403);
    expect((await h.s.get("/api/costs/quotes")).statusCode).toBe(403);
    expect(
      (await admin.send("PATCH", `/api/users/${h.id}`, { permissions: { costs: "read" } }))
        .statusCode,
    ).toBe(200);
    expect((await h.s.get("/api/costs/quotes")).statusCode).not.toBe(403);
    // A role change applies at once too.
    await admin.send("PATCH", `/api/roles/${helper.id}`, { permissions: { filament: "none" } });
    expect((await h.s.get("/api/filament/spools")).statusCode).toBe(403);
    expect(
      (await admin.get("/api/roles")).json().find((r: { id: string }) => r.id === helper.id),
    ).toMatchObject({ usersCount: 1 });
  });

  it("a user manager grants nothing above their own rights and never touches admins", async () => {
    const { admin, role, user } = await start();
    const managers = await role("Managers", {
      permissions: { "users.manage": true, prints: "write", stats: "read" },
    });
    const m = await user("m@x.io", managers.id);
    const code = async (
      r: Promise<{ json: () => { error?: { code: string } }; statusCode: number }>,
    ) => {
      const res = await r;
      return res.json().error?.code ?? res.statusCode;
    };
    expect(
      await code(m.s.send("POST", "/api/roles", { name: "Up", permissions: { prints: "manage" } })),
    ).toBe("escalation");
    const low = await m.s.send("POST", "/api/roles", {
      name: "Low",
      permissions: { prints: "read" },
    });
    expect(low.statusCode).toBe(201);
    const body = (roleId: string, extra: object = {}) => ({
      email: `${crypto.randomUUID()}@x.io`,
      displayName: "N",
      password: PW,
      roleId,
      ...extra,
    });
    // The Editor role has more than the manager: picking it is escalation.
    expect(await code(m.s.send("POST", "/api/users", body(BUILT_IN_ROLE_IDS.editor)))).toBe(
      "escalation",
    );
    expect(await code(m.s.send("POST", "/api/users", body(BUILT_IN_ROLE_IDS.admin)))).toBe(
      "admin_only",
    );
    const n = await m.s.send("POST", "/api/users", body(low.json().id));
    expect(n.statusCode).toBe(201);
    const url = `/api/users/${n.json().id}`;
    expect(await code(m.s.send("PATCH", url, { permissions: { prints: "manage" } }))).toBe(
      "escalation",
    );
    expect(await code(m.s.send("PATCH", url, { permissions: { prints: "write" } }))).toBe(200);
    // Unchanged values aren't checked again, so the form can send them back.
    await admin.send("PATCH", url, { permissions: { prints: "write", costs: "manage" } });
    expect(
      await code(m.s.send("PATCH", url, { permissions: { prints: "read", costs: "manage" } })),
    ).toBe(200);
    expect(
      await code(m.s.send("PATCH", `/api/users/${m.id}`, { permissions: { prints: "read" } })),
    ).toBe("own_account");
    // Dropping an override is a change too: back to the role's value.
    await admin.send("PATCH", `/api/users/${m.id}`, { permissions: { prints: "read" } });
    expect(await code(m.s.send("PATCH", `/api/users/${m.id}`, { permissions: {} }))).toBe(
      "own_account",
    );
    // Dropping a deny would lift the user to their role's costs manage, above the manager.
    const quoting = await role("Quoting", { permissions: { costs: "manage" } });
    const k = await user("k@x.io", quoting.id, { permissions: { costs: "none" } });
    expect(await code(m.s.send("PATCH", `/api/users/${k.id}`, { permissions: {} }))).toBe(
      "escalation",
    );
    const adminId = (await admin.get("/api/auth/me")).json().user.id;
    expect(await code(m.s.send("PATCH", `/api/users/${adminId}`, { displayName: "X" }))).toBe(
      "admin_only",
    );
    expect(await code(m.s.send("DELETE", `/api/users/${adminId}`))).toBe("admin_only");
  });

  it("the Admin role is fixed; its users take only the device files override", async () => {
    const { admin, role } = await start();
    const url = `/api/roles/${BUILT_IN_ROLE_IDS.admin}`;
    expect((await admin.send("PATCH", url, { name: "Boss" })).json().error.code).toBe(
      "role_builtin",
    );
    expect((await admin.send("DELETE", url)).json().error.code).toBe("role_builtin");
    const body = (extra: object) => ({
      email: `${crypto.randomUUID()}@x.io`,
      displayName: "A",
      password: PW,
      roleId: BUILT_IN_ROLE_IDS.admin,
      ...extra,
    });
    for (const bad of [
      { permissions: { costs: "read" } },
      { projectRights: { "projects.seeAll": false } },
    ])
      expect((await admin.send("POST", "/api/users", body(bad))).json().error.code).toBe(
        "admin_overrides",
      );
    const ok = await admin.send(
      "POST",
      "/api/users",
      body({ projectRights: { "projects.editOtherDevices": false } }),
    );
    expect(ok.statusCode).toBe(201);
    expect((await role("admin")).error.code).toBe("name_taken"); // names are unique ignoring case
  });

  it("a role in use can't be deleted; disabling one locks its users out, devices too", async () => {
    const { db, admin, role, user, app } = await start();
    const r = await role("Temps", { permissions: { prints: "read" } });
    const t = await user("t@x.io", r.id);
    expect((await admin.send("DELETE", `/api/roles/${r.id}`)).json().error.code).toBe(
      "role_in_use",
    );
    db.insert(schema.settings).values({ key: "hubEnabled", value: true }).run();
    db.insert(schema.devices)
      .values({ name: "WS", userId: t.id, tokenHash: tokenHash("dev-token") })
      .run();
    expect(readDevice(db, "dev-token")).not.toBeNull();
    await admin.send("PATCH", `/api/roles/${r.id}`, { disabled: true });
    expect((await t.s.get("/api/prints")).statusCode).toBe(401);
    expect((await login(app, "t@x.io")).json().error.code).toBe("user_disabled");
    expect(readDevice(db, "dev-token")).toBeNull();
    await admin.send("PATCH", `/api/users/${t.id}`, { roleId: BUILT_IN_ROLE_IDS.viewer });
    expect((await admin.send("DELETE", `/api/roles/${r.id}`)).statusCode).toBe(204);
  });
});

describe("who gets which alert (ADR-0016)", () => {
  type Who = ReturnType<typeof as>;
  const start = async () => {
    const { db, app } = await setup({ adapters: [mockAdapter(fixture())] });
    const me = addUser(db, "admin");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    const role = async (name: string, body: object) =>
      (await admin.send("POST", "/api/roles", { name, ...body })).json().id as string;
    const user = async (email: string, roleId: string, body: object = {}) => {
      const res = await admin.send("POST", "/api/users", {
        email,
        displayName: email,
        password: PW,
        roleId,
        ...body,
      });
      expect(res.statusCode).toBe(201);
      return { id: res.json().id as string, s: as(app, cookieOf(await login(app, email))) };
    };
    const raise = (kind: AlertKind, context: Record<string, string> = {}) =>
      db
        .insert(schema.alerts)
        .values({
          kind,
          severity: "warning",
          module: "system",
          task: kind,
          entityType: "test",
          entityId: crypto.randomUUID(),
          context,
        })
        .returning()
        .get().id;
    const ids = async (s: Who, url = "/api/alerts") => {
      const body = (await s.get(url)).json();
      return (body.items ?? body).map((a: { id: string }) => a.id) as string[];
    };
    return { db, app, me, admin, role, user, raise, ids };
  };
  const OPT_IN = ALERT_KINDS.filter((k) => ALERT_KIND_CATALOG[k].default === "off");
  const BASIC: AlertKind[] = [
    "maintenance_due",
    "spool_low",
    "warranty_ending",
    "slice_setup_changed",
    "slice_failed",
    "hub_conflict",
  ];
  // Written out, like MATRIX: sync kinds also need the policy flags (off by default).
  const GETS: Record<RoleBuiltIn, AlertKind[]> = {
    admin: ALERT_KINDS.filter((k) => !OPT_IN.includes(k)),
    // presets write (ADR-0017, ADR-0021).
    editor: [...BASIC, "preset_conflict", "preset_skipped", "preset_held"],
    viewer: BASIC,
  };

  it("each seeded role gets the kinds its permissions allow; others are a 404", async () => {
    const { admin, user, raise, ids } = await start();
    const byKind = Object.fromEntries(ALERT_KINDS.map((k) => [k, raise(k)])) as Record<
      AlertKind,
      string
    >;
    const who: Record<RoleBuiltIn, Who> = {
      admin,
      editor: (await user("e@x.io", BUILT_IN_ROLE_IDS.editor)).s,
      viewer: (await user("v@x.io", BUILT_IN_ROLE_IDS.viewer)).s,
    };
    for (const [r, s] of Object.entries(who) as [RoleBuiltIn, Who][]) {
      const got = await ids(s);
      for (const k of ALERT_KINDS) {
        const gets = GETS[r].includes(k);
        expect([r, k, got.includes(byKind[k])]).toEqual([r, k, gets]);
        expect([r, k, (await s.get(`/api/alerts/${byKind[k]}`)).statusCode]).toEqual([
          r,
          k,
          gets ? 200 : 404,
        ]);
        if (!gets)
          expect(
            (await s.send("PATCH", `/api/alerts/${byKind[k]}`, { action: "dismiss" })).statusCode,
          ).toBe(404);
      }
    }
  });

  it("condition kinds resolve for everyone; event kinds are dismissed per user", async () => {
    const { me, admin, user, raise, ids } = await start();
    // Opted in, so every kind is in play.
    const alertKinds = Object.fromEntries(OPT_IN.map((k) => [k, "app"]));
    const other = (await user("a2@x.io", BUILT_IN_ROLE_IDS.admin, { alertKinds })).s;
    await admin.send("PATCH", `/api/users/${me.id}`, { alertKinds });
    const byKind = Object.fromEntries(ALERT_KINDS.map((k) => [k, raise(k)])) as Record<
      AlertKind,
      string
    >;
    for (const k of ALERT_KINDS)
      if (!ALERT_KIND_CATALOG[k].condition)
        await admin.send("PATCH", `/api/alerts/${byKind[k]}`, { action: "dismiss" });
    // Nothing holds any of these conditions, so the check resolves them.
    expect((await admin.send("POST", "/api/alerts/evaluate")).statusCode).toBe(204);
    const [mine, theirs] = [await ids(admin), await ids(other)];
    const resolved = await ids(other, "/api/alerts/history?status=resolved&pageSize=100");
    for (const k of ALERT_KINDS) {
      const id = byKind[k];
      const condition = ALERT_KIND_CATALOG[k].condition;
      expect([k, mine.includes(id), theirs.includes(id), resolved.includes(id)]).toEqual([
        k,
        false,
        !condition,
        condition,
      ]);
    }
  });

  it("no permission, no alert, whatever the subscription; a hidden project's alert never shows", async () => {
    const { db, me, admin, role, user, raise, ids } = await start();
    const r = await role("No filament", {
      permissions: { maintenance: "read", projects: "read" },
      projectRights: { "projects.seeAll": false },
    });
    const u = await user("u@x.io", r, {
      alertKinds: { spool_low: "notify", spool_no_price: "app" },
    });
    const project = (ownerId: string) =>
      db.insert(schema.projects).values({ name: "P", ownerId }).returning().get().id;
    const theirs = raise("slice_failed", { projectId: project(me.id) });
    const own = raise("slice_failed", { projectId: project(u.id) });
    const loose = raise("hub_conflict");
    const due = raise("maintenance_due");
    const spools = [raise("spool_low"), raise("spool_no_price")];
    expect((await ids(u.s)).sort()).toEqual([own, loose, due].sort());
    for (const id of [theirs, ...spools])
      expect((await u.s.get(`/api/alerts/${id}`)).statusCode).toBe(404);
    // Off hides a kind they could get; the role's value applies on the next request.
    await admin.send("PATCH", `/api/roles/${r}`, { alertKinds: { maintenance_due: "off" } });
    expect(await ids(u.s)).not.toContain(due);
    // The user's own override wins over the role.
    await admin.send("PATCH", `/api/users/${u.id}`, { alertKinds: { maintenance_due: "app" } });
    expect(await ids(u.s)).toContain(due);
  });

  it("sync alerts need the task's flag unless the user has integrations.manage", async () => {
    const { admin, user, raise, ids } = await start();
    const editor = (await user("e@x.io", BUILT_IN_ROLE_IDS.editor)).s;
    const { id } = (
      await admin.send("POST", "/api/integrations", { adapterId: "mock", secrets: { token: "t" } })
    ).json();
    const type: Capability = (await admin.get("/api/integrations/adapters"))
      .json()[0]
      .capabilities.find((c: Capability) => !isAction(c));
    const context = { integrationId: id, type };
    const pending = raise("sync_pending", context);
    const done = raise("sync_success", context);
    expect(await ids(admin)).toEqual(expect.arrayContaining([pending, done]));
    expect(await ids(editor)).toEqual([]);
    const flags = (editorSync: boolean, editorReview: boolean) =>
      admin.send("PATCH", `/api/integrations/${id}`, {
        policies: [{ type, editorSync, editorReview }],
      });
    await flags(true, false);
    expect(await ids(editor)).toEqual([done]);
    await flags(false, true);
    expect(await ids(editor)).toEqual([pending]);
  });

  it("coverage lists the condition kinds no enabled user gets", async () => {
    const { me, admin, user } = await start();
    const coverage = async () => (await admin.get("/api/alerts/coverage")).json();
    // The opt-in checks are never listed, though nobody gets them.
    expect(await coverage()).toEqual([]);
    await admin.send("PATCH", `/api/users/${me.id}`, { alertKinds: { maintenance_due: "off" } });
    expect(await coverage()).toEqual(["maintenance_due"]);
    const v = await user("v@x.io", BUILT_IN_ROLE_IDS.viewer);
    expect(await coverage()).toEqual([]);
    expect((await v.s.get("/api/alerts/coverage")).statusCode).toBe(403);
    await admin.send("PATCH", `/api/users/${v.id}`, { disabled: true });
    expect(await coverage()).toEqual(["maintenance_due"]);
  });
});
