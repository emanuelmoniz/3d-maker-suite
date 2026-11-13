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
import { BUILT_IN_ROLE_IDS, type Pick, PROJECT_TRASH_DIR } from "@3d-maker-suite/core";
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
      .values({
        email: `${role}@x.io`,
        displayName: role,
        roleId: BUILT_IN_ROLE_IDS[role],
        passwordHash: hash,
        ...flags,
      })
      .returning()
      .get();
  const admin = user("admin");
  const editor = user("editor", { projectRights: { "projects.seeAll": false } });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: admin.email, password: PW },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });
  // These devices receive every hub project folder: a whole-root pick each, made at pairing.
  await send("PATCH", "/api/preferences", { hubEnabled: true, hubDefaultSyncMode: "all" });
  const dir = temp("hub-sync-root-");
  const root = (await send("POST", "/api/roots", { path: dir })).json();
  /** Pairs a device for `userId`; its sync calls. */
  const pair = async (userId: string, name: string) => {
    const { code } = (await send("POST", "/api/hub/pairing-codes", { userId })).json();
    const { token } = (
      await app.inject({ method: "POST", url: "/api/hub/pair", payload: { code, name } })
    ).json();
    const authorization = `Bearer ${token}`;
    const file = (path: string) =>
      `/api/hub/device/sync/roots/${root.id}/file?path=${encodeURIComponent(path)}`;
    return {
      authorization,
      put: (path: string, body: string, base: number) =>
        app.inject({
          method: "PUT",
          url: `${file(path)}&base=${base}`,
          payload: Buffer.from(body),
          headers: {
            authorization,
            "content-type": "application/octet-stream",
            "x-file-sha256": sha(body),
          },
        }),
      changes: async (since = 0) =>
        (
          await app.inject({
            url: `/api/hub/device/sync/changes?since=${since}`,
            headers: { authorization },
          })
        ).json(),
      get: (path: string) => app.inject({ url: file(path), headers: { authorization } }),
      del: (path: string, base: number) =>
        app.inject({
          method: "DELETE",
          url: `${file(path)}&base=${base}`,
          headers: { authorization },
        }),
    };
  };
  const desk = await pair(editor.id, "Desk: PC");
  const { authorization, put, changes, get, del } = desk;
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
  /** The desk's picks, as Projects settings → Sources lists them; and its id. */
  const deskId = () => db.select().from(schema.devices).get()?.id ?? "";
  const picks = async (): Promise<Pick[]> =>
    (await send("GET", "/api/hub/devices")).json()[0].picks;
  const pickUrl = (pickId = "") => `/api/hub/devices/${deskId()}/picks${pickId && `/${pickId}`}`;
  return {
    deskId,
    picks,
    pickUrl,
    db,
    app,
    send,
    cookie,
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
    pair,
    desk,
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
    s.db
      .update(schema.users)
      .set({ projectRights: { "projects.editOthers": false } })
      .run();
    expect((await s.changes()).files).toMatchObject([
      { path: "mine/a.stl", access: "edit" },
      { path: "theirs/b.stl", access: "read" },
    ]);
    expect((await s.put("theirs/b.stl", "x", 1)).statusCode).toBe(403);
    expect((await s.del("theirs/b.stl", 1)).statusCode).toBe(403);
  });

  it("syncs only its picks, at their level, within its user's rights", async () => {
    const s = await setup();
    for (const [folder, owner] of [
      ["a/p1", s.editor.id],
      ["a/p2", s.editor.id],
      ["b", s.admin.id],
    ] as const) {
      mkdirSync(join(s.dir, folder), { recursive: true });
      writeFileSync(join(s.dir, folder, "m.stl"), folder);
      s.project(folder, owner);
    }
    await s.scan();
    const paths = async () =>
      (await s.changes()).files
        .map((f: { path: string; access: string }) => [f.path, f.access])
        .sort((a: string[], b: string[]) => String(a[0]).localeCompare(String(b[0])));
    // Paired with "every hub project folder": the whole root at Edit; "b" is the admin's, which
    // the editor (the machine's user) can't see.
    const [whole] = await s.picks();
    expect(whole).toEqual({
      id: expect.any(String),
      rootId: s.root.id,
      rootName: s.root.name,
      path: "",
      level: "edit",
      paused: false,
    });
    expect(await paths()).toEqual([
      ["a/p1/m.stl", "edit"],
      ["a/p2/m.stl", "edit"],
    ]);

    // Projects manage or hub.manage only; the editor has projects write.
    const asEditor = await s.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: s.editor.email, password: PW },
    });
    const cookie = String(asEditor.headers["set-cookie"]).split(";")[0] ?? "";
    expect(
      (await s.app.inject({ method: "DELETE", url: s.pickUrl(whole?.id), headers: { cookie } }))
        .statusCode,
    ).toBe(403);
    expect((await s.send("DELETE", s.pickUrl(whole?.id))).json()).toEqual([]);
    expect(await paths()).toEqual([]);

    // A subfolder pick at Read: download-only on the machine though its user may edit.
    const add = (path: string, level: string) =>
      s.send("POST", s.pickUrl(), { rootId: s.root.id, path, level });
    const set = (id: string, body: object) => s.send("PATCH", s.pickUrl(id), body);
    const [p1] = (await add("a/p1", "read")).json();
    expect(await paths()).toEqual([["a/p1/m.stl", "read"]]);
    expect((await s.put("a/p1/m.stl", "x", 1)).statusCode).toBe(403);
    expect((await s.put("a/p1/new.stl", "x", 0)).statusCode).toBe(403);
    expect((await s.get("a/p2/m.stl")).statusCode).toBe(404);
    expect((await add("a/p1", "edit")).statusCode).toBe(409);
    expect((await add("../x", "edit")).statusCode).toBe(400);
    expect((await add("a", "owner")).statusCode).toBe(400);

    // At Edit; a Read pick around it doesn't lower it, and brings its sibling read-only.
    await set(p1.id, { level: "edit" });
    expect((await s.put("a/p1/m.stl", "x", 1)).json()).toMatchObject({ status: "updated" });
    const [a] = (await add("a", "read")).json();
    expect(await paths()).toEqual([
      ["a/p1/m.stl", "edit"],
      ["a/p2/m.stl", "read"],
    ]);

    // Paused: as if removed, and kept.
    await set(a.id, { paused: true });
    expect(await paths()).toEqual([["a/p1/m.stl", "edit"]]);
    expect((await s.picks()).map((p) => [p.path, p.level, p.paused])).toEqual([
      ["a", "read", true],
      ["a/p1", "edit", false],
    ]);

    // A pick never gives more than the machine's user may: "b" stays hidden from the editor.
    await add("b", "edit");
    expect(await paths()).toEqual([["a/p1/m.stl", "edit"]]);
    // The picks are the machine's: with another user, the same picks follow that user's rights.
    s.db.update(schema.devices).set({ userId: s.admin.id }).run();
    expect(await paths()).toEqual([
      ["a/p1/m.stl", "edit"],
      ["b/m.stl", "edit"],
    ]);

    // Receive off: nothing at all.
    await s.send("PATCH", `/api/hub/devices/${s.deskId()}`, { receiveProjects: false });
    expect(await paths()).toEqual([]);
    const roots = await s.app.inject({
      url: "/api/hub/device/sync/roots",
      headers: { authorization: s.authorization },
    });
    expect(roots.json().roots).toEqual([{ id: s.root.id, name: s.root.name, picked: false }]);
  });
});

describe("no locks, last saved by", () => {
  it("two devices saving the same file: a conflict copy, nothing read-only", async () => {
    const s = await setup();
    s.project("a", s.editor.id);
    const p = s.db.select().from(schema.projects).get();
    if (!p) throw new Error("setup");
    const laptop = await s.pair(s.admin.id, "Laptop");
    expect((await s.desk.put("a/m.3mf", "v1", 0)).json()).toEqual({
      status: "updated",
      version: 1,
    });
    // The first save takes nothing: the other device may edit it too.
    for (const d of [s.desk, laptop])
      expect((await d.changes()).files).toMatchObject([
        { path: "a/m.3mf", access: "edit", lock: null },
      ]);
    expect((await laptop.put("a/m.3mf", "from laptop", 1)).json()).toEqual({
      status: "updated",
      version: 2,
    });
    // The desk still started from 1: its save is kept beside the file.
    expect((await s.desk.put("a/m.3mf", "from desk", 1)).json()).toMatchObject({
      status: "conflict",
      version: 2,
    });
    expect(readFileSync(join(s.dir, "a", "m.3mf"), "utf8")).toBe("from laptop");
    expect(
      readdirSync(join(s.dir, "a")).filter((n) => n.includes("(conflict Desk- PC")),
    ).toHaveLength(1);

    // Last saved by: the save that reached the hub, then a web upload (no device).
    const saved = async () => (await s.send("GET", `/api/projects/${p.id}/saved`)).json();
    expect(await saved()).toContainEqual({
      file: "m.3mf",
      user: "admin",
      device: "Laptop",
      savedAt: expect.any(String),
    });
    // The list gives the file's hash; the upload sends it back as its base.
    const listed = (await s.send("GET", `/api/projects/${p.id}/files`)).json();
    const base = listed.entries.find((e: { path: string }) => e.path === "m.3mf").sha256;
    expect(base).toBe(createHash("sha256").update("from laptop").digest("hex"));
    const up = await s.app.inject({
      method: "PUT",
      url: `/api/projects/${p.id}/files/content?path=m.3mf&replace=true&base=${base}`,
      payload: Buffer.from("from the web"),
      headers: {
        cookie: s.cookie,
        "content-type": "application/octet-stream",
      },
    });
    expect(up.statusCode).toBe(200);
    expect(await saved()).toContainEqual({
      file: "m.3mf",
      user: "admin",
      device: null,
      savedAt: expect.any(String),
    });
  });

  it("a web upload: checked against the listed hash, the old content kept as a version", async () => {
    const s = await setup();
    s.project("a", s.editor.id);
    const p = s.db.select().from(schema.projects).get();
    if (!p) throw new Error("setup");
    await s.send("PATCH", "/api/preferences", { hubVersions: true });
    await s.desk.put("a/m.3mf", "v1", 0);
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const web = (body: string, base?: string) =>
      s.app.inject({
        method: "PUT",
        url: `/api/projects/${p.id}/files/content?path=m.3mf&replace=true${base ? `&base=${base}` : ""}`,
        payload: Buffer.from(body),
        headers: { cookie: s.cookie, "content-type": "application/octet-stream" },
      });
    const disk = () => readFileSync(join(s.dir, "a", "m.3mf"), "utf8");

    // Unchanged since the list: replaced, the old content is a version.
    expect((await web("v2", sha("v1"))).json()).toEqual({ path: "m.3mf" });
    expect(disk()).toBe("v2");
    const versions = await s.send("GET", `/api/projects/${p.id}/versions?file=m.3mf`);
    expect(versions.json()).toMatchObject([{ version: 1, size: 2 }]);
    const v1 = await s.send("GET", `/api/projects/${p.id}/versions/download?file=m.3mf&version=1`);
    expect(v1.body).toBe("v1");

    // Changed since (the page listed v1), or no base for a file that is there: a conflict copy.
    for (const base of [sha("v1"), undefined]) {
      const r = await web("mine", base);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({
        path: expect.stringContaining("(conflict admin "),
        conflict: true,
      });
      expect(disk()).toBe("v2");
      expect(readFileSync(join(s.dir, "a", r.json().path), "utf8")).toBe("mine");
    }
    const alerts = s.db.select().from(schema.alerts).all();
    expect(alerts.filter((a) => a.kind === "hub_conflict")).toHaveLength(2);
    expect(alerts.find((a) => a.kind === "hub_conflict")?.context).toMatchObject({
      file: "a/m.3mf",
      user: "admin",
    });
  });
});

describe("file versions", () => {
  it("keeps the newest N earlier versions, intact, and prunes when N is lowered", async () => {
    const s = await setup();
    s.project("a", s.editor.id);
    const p = s.db.select().from(schema.projects).get();
    if (!p) throw new Error("setup");
    const list = async () =>
      (await s.send("GET", `/api/projects/${p.id}/versions?file=m.3mf`)).json() as {
        version: number;
        user: string | null;
        device: string | null;
        size: number;
      }[];
    const save = async (body: string, base: number) =>
      expect((await s.desk.put("a/m.3mf", body, base)).json()).toMatchObject({ status: "updated" });

    // Off: nothing is kept.
    await save("v1", 0);
    await save("v2", 1);
    expect(await list()).toEqual([]);

    await s.send("PATCH", "/api/preferences", { hubVersions: true, hubVersionsKeep: 2 });
    for (const [i, body] of ["v3", "v4", "v5", "v6"].entries()) await save(body, i + 2);
    // Version 6 is live; 5 and 4 are kept, 3 was pruned.
    expect((await list()).map((v) => v.version)).toEqual([5, 4]);
    expect((await list())[0]).toMatchObject({ user: "editor", device: "Desk: PC", size: 2 });
    const dl = (v: number) =>
      s.send("GET", `/api/projects/${p.id}/versions/download?file=m.3mf&version=${v}`);
    expect((await dl(4)).body).toBe("v4");
    expect((await dl(5)).body).toBe("v5");
    expect((await dl(3)).statusCode).toBe(404);
    expect((await s.send("GET", "/api/hub/versions")).json()).toEqual({ files: 2, bytes: 4 });

    // Lowering N prunes at once.
    await s.send("PATCH", "/api/preferences", { hubVersionsKeep: 1 });
    await expect.poll(async () => (await list()).map((v) => v.version)).toEqual([5]);
    expect((await dl(4)).statusCode).toBe(404);
  });
});
