import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT_TRASH_DIR } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { buildApp } from "./app.ts";
import { hashPassword } from "./lib/password.ts";

const PW = "password123";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PW);
});
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** A hub with one hub root and a device paired for an editor. */
const setup = async (opts: Parameters<typeof buildApp>[3] = {}) => {
  const db = openDb(":memory:");
  const app = await buildApp(db, { stream: { write: () => true } }, temp("hub-sync-data-"), opts);
  onTestFinished(() => app.close());
  const user = (role: "admin" | "editor" | "viewer", flags: object = {}) =>
    db
      .insert(schema.users)
      .values({ email: `${role}@x.io`, displayName: role, role, passwordHash: hash, ...flags })
      .returning()
      .get();
  const admin = user("admin");
  const editor = user("editor", { projectsSeeAll: false });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: admin.email, password: PW },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });
  await send("PATCH", "/api/preferences", { hubEnabled: true });
  const dir = temp("hub-sync-root-");
  const root = (await send("POST", "/api/roots", { path: dir })).json();
  const { code } = (await send("POST", "/api/hub/pairing-codes", { userId: editor.id })).json();
  const { token } = (
    await app.inject({
      method: "POST",
      url: "/api/hub/pair",
      payload: { code, name: "Desk: PC" },
    })
  ).json();
  const authorization = `Bearer ${token}`;
  const file = (path: string) =>
    `/api/hub/device/sync/roots/${root.id}/file?path=${encodeURIComponent(path)}`;
  const put = (path: string, body: string, base: number) =>
    app.inject({
      method: "PUT",
      url: `${file(path)}&base=${base}`,
      payload: Buffer.from(body),
      headers: {
        authorization,
        "content-type": "application/octet-stream",
        "x-file-sha256": sha(body),
      },
    });
  const changes = async (since = 0) =>
    (
      await app.inject({
        url: `/api/hub/device/sync/changes?since=${since}`,
        headers: { authorization },
      })
    ).json();
  const get = (path: string) => app.inject({ url: file(path), headers: { authorization } });
  const del = (path: string, base: number) =>
    app.inject({ method: "DELETE", url: `${file(path)}&base=${base}`, headers: { authorization } });
  const project = (folder: string, ownerId: string | null) =>
    db.insert(schema.projects).values({ name: folder, rootId: root.id, folder, ownerId }).run();
  const idle = () =>
    expect.poll(async () => (await send("GET", "/api/projects/scan")).json().state).toBe("idle");
  // Turning the hub on started a scan; a scan asked for while it runs would join it.
  await idle();
  const scan = async () => {
    await send("POST", "/api/projects/scan");
    await idle();
  };
  return {
    db,
    app,
    send,
    admin,
    editor,
    dir,
    root,
    authorization,
    put,
    changes,
    get,
    del,
    project,
    scan,
  };
};

describe("hub file sync", () => {
  it("gives two uploads of the same base exactly one version and one conflict copy", async () => {
    const s = await setup();
    expect((await s.put("a/model.3mf", "v1", 0)).json()).toEqual({ status: "updated", version: 1 });
    const [x, y] = await Promise.all([
      s.put("a/model.3mf", "from x", 1),
      s.put("a/model.3mf", "from y", 1),
    ]);
    const results = [x.json(), y.json()];
    expect(results.map((r) => r.status).sort()).toEqual(["conflict", "updated"]);
    const won = results.find((r) => r.status === "updated");
    const lost = results.find((r) => r.status === "conflict");
    expect(won.version).toBe(2);
    expect(lost.path).toMatch(
      /^a\/model \(conflict Desk- PC \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\)\.3mf$/,
    );
    const names = readdirSync(join(s.dir, "a")).sort();
    expect(names).toHaveLength(2);
    // The loser's bytes are in the copy, the winner's at the path; no temp file is left.
    const winner = readFileSync(join(s.dir, "a", "model.3mf"), "utf8");
    const loser = readFileSync(join(s.dir, lost.path), "utf8");
    expect([winner, loser].sort()).toEqual(["from x", "from y"]);
    const alerts = s.db.select().from(schema.alerts).all();
    expect(alerts).toMatchObject([
      { kind: "hub_conflict", context: { file: "a/model.3mf", copy: lost.path } },
    ]);
    const feed = await s.changes();
    expect(
      feed.files.map((f: { path: string; version: number }) => [f.path, f.version]).sort(),
    ).toEqual(
      [
        ["a/model.3mf", 2],
        [lost.path, 1],
      ].sort(),
    );
  });

  it("takes the same bytes as unchanged and refuses a damaged upload", async () => {
    const s = await setup();
    await s.put("p.stl", "same", 0);
    expect((await s.put("p.stl", "same", 0)).json()).toEqual({ status: "unchanged", version: 1 });
    const bad = await s.app.inject({
      method: "PUT",
      url: `/api/hub/device/sync/roots/${s.root.id}/file?path=q.stl&base=0`,
      payload: Buffer.from("bytes"),
      headers: {
        authorization: s.authorization,
        "content-type": "application/octet-stream",
        "x-file-sha256": sha("other"),
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(readdirSync(s.dir)).toEqual(["p.stl"]);
    for (const path of ["../x.stl", ".hidden/x.stl", `${PROJECT_TRASH_DIR}/x.stl`, "m.3mf.tmp"])
      expect((await s.put(path, "x", 0)).statusCode).toBe(400);
  });

  it("feeds changes in order: edits on the hub, deletes as tombstones", async () => {
    const s = await setup();
    await s.put("a/one.stl", "1", 0);
    const first = await s.changes();
    expect(first.files).toMatchObject([
      { path: "a/one.stl", version: 1, deleted: false, access: "edit" },
    ]);
    // An edit made on the hub itself: a download checks the disk first.
    writeFileSync(join(s.dir, "a", "one.stl"), "1 edited");
    const got = await s.get("a/one.stl");
    expect(got.body).toBe("1 edited");
    expect(got.headers["x-file-version"]).toBe("2");
    expect(got.headers["x-file-sha256"]).toBe(sha("1 edited"));
    const next = await s.changes(first.cursor);
    expect(next.files).toMatchObject([{ path: "a/one.stl", version: 2 }]);
    expect(next.cursor).toBeGreaterThan(first.cursor);
    expect((await s.changes(next.cursor)).files).toEqual([]);

    // Deleting a version the hub no longer has is refused; the current one goes to the trash.
    expect((await s.del("a/one.stl", 1)).statusCode).toBe(409);
    expect((await s.del("a/one.stl", 2)).statusCode).toBe(204);
    expect(existsSync(join(s.dir, "a", "one.stl"))).toBe(false);
    expect(readdirSync(join(s.dir, PROJECT_TRASH_DIR))).toHaveLength(1);
    expect((await s.changes(next.cursor)).files).toMatchObject([
      { path: "a/one.stl", deleted: true },
    ]);
    // A first sync leaves tombstones out; a new file at that path is taken whatever the base.
    expect((await s.changes()).files).toEqual([]);
    expect((await s.put("a/one.stl", "again", 0)).json()).toEqual({
      status: "updated",
      version: 3,
    });
  });

  it("indexes what a scan finds, any depth", async () => {
    const s = await setup();
    mkdirSync(join(s.dir, "p", "deep", "er"), { recursive: true });
    writeFileSync(join(s.dir, "p", "deep", "er", "x.stl"), "x");
    writeFileSync(join(s.dir, "p", "x.3mf.tmp"), "half");
    await s.scan();
    // The scan made "p" a project of nobody's: hidden from this editor's feed, but indexed.
    expect(s.db.select({ path: schema.hubFiles.path }).from(schema.hubFiles).all()).toEqual([
      { path: "p/deep/er/x.stl" },
    ]);
  });

  it("indexes what the watcher sees, and an upload only once", async () => {
    const s = await setup({ watchProjects: true });
    await s.scan(); // points the watcher at the new root
    await new Promise((r) => setTimeout(r, 1000)); // let the watcher settle
    await s.put("up.stl", "up", 0);
    writeFileSync(join(s.dir, "by-hand.stl"), "hand");
    const rows = () =>
      s.db
        .select({ path: schema.hubFiles.path, version: schema.hubFiles.version })
        .from(schema.hubFiles)
        .all();
    await expect.poll(rows, { timeout: 10_000, interval: 200 }).toContainEqual({
      path: "by-hand.stl",
      version: 1,
    });
    expect(rows()).toContainEqual({ path: "up.stl", version: 1 });
  }, 15_000);

  it("follows the user's rights: hidden projects left out, download-only read-only", async () => {
    const s = await setup();
    mkdirSync(join(s.dir, "mine"));
    mkdirSync(join(s.dir, "theirs"));
    writeFileSync(join(s.dir, "mine", "a.stl"), "a");
    writeFileSync(join(s.dir, "theirs", "b.stl"), "b");
    s.project("mine", s.editor.id);
    s.project("theirs", s.admin.id);
    await s.get("mine/a.stl");
    expect((await s.get("theirs/b.stl")).statusCode).toBe(404);
    expect((await s.put("theirs/b.stl", "x", 0)).statusCode).toBe(404);
    await s.scan();
    expect((await s.changes()).files).toMatchObject([{ path: "mine/a.stl", access: "edit" }]);

    // Seeing everything but editing only their own: someone else's project is download-only.
    s.db.update(schema.users).set({ projectsSeeAll: true, projectsEditOthers: false }).run();
    expect((await s.changes()).files).toMatchObject([
      { path: "mine/a.stl", access: "edit" },
      { path: "theirs/b.stl", access: "read" },
    ]);
    expect((await s.put("theirs/b.stl", "x", 1)).statusCode).toBe(403);
    expect((await s.del("theirs/b.stl", 1)).statusCode).toBe(403);
  });

  it("syncs only selected projects; Open selects one and asks the device", async () => {
    const s = await setup();
    for (const f of ["mine", "other"]) {
      mkdirSync(join(s.dir, f));
      writeFileSync(join(s.dir, f, "m.stl"), f);
      s.project(f, s.editor.id);
    }
    await s.scan();
    const device = s.db.select().from(schema.devices).get();
    const mine = s.db
      .select()
      .from(schema.projects)
      .all()
      .find((p) => p.folder === "mine");
    if (!device || !mine) throw new Error("setup");
    expect(
      (await s.send("PATCH", `/api/hub/devices/${device.id}`, { syncMode: "selected" })).statusCode,
    ).toBe(204);
    expect((await s.changes()).files).toEqual([]);

    // Online, with a slicer: the device's user gets Open on my workstation.
    const base = await s.app.listen({ port: 0, host: "127.0.0.1" });
    const res = await fetch(`${base}/api/hub/events`, {
      headers: { authorization: s.authorization },
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let text = "";
    const until = async (what: string) => {
      while (!text.includes(what)) {
        const { done, value } = await reader.read();
        if (done) return text;
        text += dec.decode(value, { stream: true });
      }
      return text;
    };
    await until(": open");
    const login = await s.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: s.editor.email, password: PW },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    const asEditor = (method: "GET" | "POST", url: string, payload?: object) =>
      s.app.inject({ method, url, payload, headers: { cookie } });
    expect((await asEditor("GET", `/api/projects/${mine.id}/devices`)).json()).toEqual([]);
    await s.app.inject({
      method: "PUT",
      url: "/api/hub/device/slicers",
      payload: [{ id: "bambu-studio", version: "2.8", path: "C:/bambu-studio.exe" }],
      headers: { authorization: s.authorization },
    });
    expect((await asEditor("GET", `/api/projects/${mine.id}/devices`)).json()).toEqual([
      { id: device.id, name: "Desk: PC" },
    ]);

    const opening = asEditor("POST", `/api/projects/${mine.id}/open`, {
      target: "device",
      deviceId: device.id,
      file: "m.stl",
    });
    const event = JSON.parse(/data: (\{"type":"open".*)/.exec(await until('"open"'))?.[1] ?? "");
    expect(event).toMatchObject({ rootId: s.root.id, path: "mine/m.stl" });
    // Selected now: the device pulls it before it opens the slicer.
    expect((await s.changes()).files).toMatchObject([{ path: "mine/m.stl" }]);
    await s.app.inject({
      method: "POST",
      url: `/api/hub/device/replies/${event.requestId}`,
      payload: { ok: true, result: null },
      headers: { authorization: s.authorization },
    });
    expect((await opening).json()).toEqual({ ok: true });

    // Hub management takes it off the device: the connector syncs again, its copy goes.
    const off = await s.send("DELETE", `/api/hub/devices/${device.id}/projects/${mine.id}`);
    expect(off.statusCode).toBe(204);
    await until('"roots.changed"');
    expect((await s.changes()).files).toEqual([]);
    await reader.cancel();
  });
});
