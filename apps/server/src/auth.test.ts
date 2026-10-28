import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import { type Capability, isAction, REVIEWED_TYPES, type UserRole } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { buildApp } from "./app.ts";
import { can, loginLimiter } from "./lib/auth.ts";
import { hashPassword } from "./lib/password.ts";

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
const addUser = (db: ReturnType<typeof openDb>, role: UserRole, email = `${role}@x.io`) =>
  db
    .insert(schema.users)
    .values({ email, displayName: role, role, passwordHash: hash })
    .returning()
    .get();
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
const MATRIX: Record<string, [viewer: string, editor: string]> = {
  "/api/auth/me": ["RW", "RW"],
  "/api/printers": ["R", "R"],
  "/api/accessories": ["R", "R"],
  "/api/maintenance": ["R", "R"],
  "/api/brands": ["R", "R"],
  "/api/printer-models": ["R", "R"],
  "/api/machine-profiles": ["R", "R"],
  "/api/filament": ["R", "RW"],
  "/api/filament-brands": ["R", "R"],
  "/api/filament-materials": ["R", "R"],
  "/api/print-profiles": ["R", "R"],
  "/api/projects": ["R", "RW"],
  "/api/roots": ["R", "R"],
  "/api/prints": ["R", "RW"],
  "/api/costs": ["R", "RW"],
  "/api/orders": ["R", "RW"],
  "/api/clients": ["R", "RW"],
  "/api/accessories/abc/installs": ["R", "RW"],
  "/api/maintenance/tasks": ["R", "RW"],
  "/api/maintenance/types": ["R", "R"],
  "/api/filament/profiles": ["R", "R"],
  "/api/stats": ["R", "R"],
  "/api/tags": ["R", "RW"],
  "/api/collections": ["R", "RW"],
  "/api/alerts": ["R", "RW"],
  "/api/alerts/channels": ["-", "-"],
  "/api/preferences": ["RW", "RW"],
  "/api/branding": ["R", "R"],
  "/api/branding/logo": ["R", "R"],
  "/api/backups/restore": ["-", "-"],
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
  "/api/hub/devices": ["-", "-"],
  "/api/hub/pairing-codes": ["-", "-"],
  "/api/docs": ["-", "-"],
  "/api/not-yet-in-the-table": ["-", "-"],
};

describe("permissions", () => {
  it("every prefix × role × read/write matches ADR-0012", () => {
    for (const [url, [viewer, editor]] of Object.entries(MATRIX))
      for (const [role, access] of [
        ["viewer", viewer],
        ["editor", editor],
        ["admin", "RW"],
      ] as const) {
        const got = `${can(role, url, "GET") ? "R" : ""}${can(role, url, "POST") ? "W" : ""}`;
        expect(`${role} ${url} ${got || "-"}`).toBe(`${role} ${url} ${access}`);
      }
  });

  it("a viewer may PATCH their alert state, nothing else under /alerts", () => {
    expect(can("viewer", "/api/alerts/abc", "PATCH")).toBe(true);
    expect(can("viewer", "/api/alerts/evaluate", "POST")).toBe(false);
    expect(can("viewer", "/api/alerts/channels/ntfy", "PATCH")).toBe(false);
    expect(can("viewer", "/api/alerts/channels/ntfy", "PUT")).toBe(false);
    expect(can("editor", "/api/alerts/channels/ntfy", "PATCH")).toBe(false);
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
    expect((await app.inject("/api/auth/me")).json()).toEqual({ user: null });

    for (const role of ["admin", "editor", "viewer"] as const) addUser(db, role);
    expect((await app.inject("/api/printers")).statusCode).toBe(401);
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect((await app.inject("/some/spa/route")).statusCode).toBe(404); // public, no SPA in tests

    const viewer = as(app, cookieOf(await login(app, "viewer@x.io")));
    expect((await viewer.get("/api/auth/me")).json().user.role).toBe("viewer");
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
    const old = raise({ kind: "sync_success", severity: "success", readAt: legacyRead });
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

  it("preferences: own display keys for everyone, the rest admin-only", async () => {
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
    expect(ok.json().user).toMatchObject({ email: "me@x.io", role: "admin" });
    expect((await as(app, cookieOf(ok)).get("/api/users")).statusCode).toBe(200);
    expect((await post(body, "127.0.0.1")).json().error.code).toBe("setup_done");

    const local = await setup();
    const res = await local.app.inject({ method: "POST", url: "/api/auth/setup", payload: body });
    expect(res.statusCode).toBe(201);
  });

  it("the last enabled admin can't be disabled, demoted or deleted", async () => {
    const { db, app } = await setup();
    const me = addUser(db, "admin");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    const url = `/api/users/${me.id}`;
    for (const payload of [{ role: "editor" }, { disabled: true }])
      expect((await admin.send("PATCH", url, payload)).json().error.code).toBe("last_admin");
    expect((await admin.send("DELETE", url)).statusCode).toBe(409);

    const other = await admin.send("POST", "/api/users", {
      email: "two@x.io",
      displayName: "Two",
      password: PW,
      role: "admin",
    });
    expect(other.statusCode).toBe(201);
    expect((await admin.send("PATCH", url, { role: "editor" })).statusCode).toBe(200);
    // Changing the role ended the session.
    expect((await admin.get("/api/auth/me")).statusCode).toBe(401);
  });

  it("disabling, a role change or a reset ends the user's sessions", async () => {
    const { db, app } = await setup();
    addUser(db, "admin");
    const viewer = addUser(db, "viewer");
    const admin = as(app, cookieOf(await login(app, "admin@x.io")));
    const url = `/api/users/${viewer.id}`;
    for (const [change, undo] of [
      [{ disabled: true }, { disabled: false }],
      [{ role: "editor" }, { role: "viewer" }],
      [{ password: "a new one!" }, { password: PW }],
    ]) {
      const session = as(app, cookieOf(await login(app, "viewer@x.io")));
      expect((await session.get("/api/auth/me")).statusCode).toBe(200);
      await admin.send("PATCH", url, change);
      expect((await session.get("/api/auth/me")).statusCode).toBe(401);
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
      role: "viewer",
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
