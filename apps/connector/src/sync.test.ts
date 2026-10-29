// Two connectors and a real hub (the server's buildApp on a free port) syncing a hub root.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT_TRASH_DIR } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLink } from "./hub.ts";
import { openStore } from "./state.ts";
import { folderName, type HubSync } from "./sync.ts";

const until = async (ok: () => boolean | Promise<boolean>, ms = 20_000) => {
  for (const end = Date.now() + ms; !(await ok()); await new Promise((r) => setTimeout(r, 50)))
    if (Date.now() > end) throw new Error("timed out");
};
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined);
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe("folderName", () => {
  it("makes a root's name a safe, unique folder name", () => {
    expect(folderName("Library", [])).toBe("Library");
    expect(folderName("a/b: c?", [])).toBe("a-b- c-");
    expect(folderName(".hidden. ", [])).toBe("hidden");
    expect(folderName("...", [])).toBe("Root");
    expect(folderName("Library", ["library", "Library (2)"])).toBe("Library (3)");
  });
});

describe("hub root sync", () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const f of cleanup.splice(0).reverse()) await f();
  });

  const hub = async () => {
    const db = openDb(":memory:");
    const dataDir = temp("sync-hub-data-");
    const app = await buildApp(db, { stream: { write: () => true } }, dataDir);
    const passwordHash = await hashPassword("password123");
    const user = (role: "admin" | "viewer") =>
      db
        .insert(schema.users)
        .values({ email: `${role}@x.io`, displayName: role, role, passwordHash })
        .returning()
        .get();
    const users = { admin: user("admin"), viewer: user("viewer") };
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: users.admin.email, password: "password123" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
      app.inject({ method, url, payload, headers: { cookie } });
    await send("PATCH", "/api/preferences", { hubEnabled: true });
    const dir = temp("sync-hub-root-");
    const root = (await send("POST", "/api/roots", { path: dir })).json();
    const scan = async () => {
      await until(async () => (await send("GET", "/api/projects/scan")).json().state === "idle");
      await send("POST", "/api/projects/scan");
      await until(async () => (await send("GET", "/api/projects/scan")).json().state === "idle");
    };
    await scan();
    const code = async (role: "admin" | "viewer" = "admin") =>
      (await send("POST", "/api/hub/pairing-codes", { userId: users[role].id })).json()
        .code as string;
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    cleanup.push(() => {
      app.server.closeAllConnections();
      return app
        .close()
        .finally(() => [dataDir, dir].map((d) => rmSync(d, { recursive: true, force: true })));
    });
    /** Writes a file on the hub itself, then scans so the index has it. */
    const put = async (rel: string, text: string) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), text);
      await scan();
    };
    const open = (kind: string) =>
      db
        .select()
        .from(schema.alerts)
        .all()
        .filter((a) => a.kind === kind && !a.resolvedAt);
    return { url, send, code, dir, root, put, scan, open };
  };
  type Hub = Awaited<ReturnType<typeof hub>>;

  /** A connector with its own data and sync folder; `dir` again = the same one restarted. */
  const device = async (
    h: Hub,
    name: string,
    role: "admin" | "viewer" = "admin",
    dir?: string,
    slicers?: Parameters<typeof createLink>[0]["slicers"],
    hooks?: Omit<NonNullable<Parameters<typeof createLink>[0]["sync"]>, "dataDir" | "syncDir">,
  ) => {
    const at = dir ?? temp("sync-device-");
    const store = openStore(at);
    const link = createLink({
      store,
      version: "5.0.0-test",
      os: "TestOS x64",
      sync: { dataDir: at, syncDir: join(at, "sync"), ...hooks },
      slicers,
    });
    // Cleanup runs backwards: the link closes, and its last sync work ends, before its folder goes.
    if (!dir) cleanup.push(() => rmSync(at, { recursive: true, force: true }));
    cleanup.push(async () => {
      link.close();
      // The stream's end queues the strict-locks check a moment later.
      await new Promise((r) => setTimeout(r, 200));
      await link.sync?.idle();
    });
    if (store.token()) link.start();
    else await link.pair(h.url, await h.code(role), name);
    await until(() => link.state().status === "online");
    return {
      dir: at,
      id: store.get().deviceId ?? "",
      link,
      folder: join(at, "sync", h.root.name),
      sync: () => link.sync as HubSync,
    };
  };

  it("with selected projects, Open downloads the project and opens the slicer; the save syncs back", async () => {
    const h = await hub();
    await h.put("p/m.stl", "model");
    await h.put("q/n.stl", "other");
    const started: string[] = [];
    const folders: string[] = [];
    const a = await device(h, "WS-A", "admin", undefined, {
      find: async () => [
        {
          id: "bambu-studio",
          name: "Bambu Studio",
          version: "2",
          path: "bs",
          cmd: "bs",
          args: [],
          cli: { cmd: "bs", args: [] },
        },
      ],
      start: async (_cmd, args) => {
        started.push(args.at(-1) ?? "");
        return undefined;
      },
      openDir: async (dir) => folders.push(dir),
    });
    await until(() => read(join(a.folder, "q/n.stl")) === "other");

    // Selected projects only: the local copies go, and nothing goes on the hub.
    await h.send("PATCH", `/api/hub/devices/${a.id}`, { syncMode: "selected" });
    await until(
      () => !existsSync(join(a.folder, "p/m.stl")) && !existsSync(join(a.folder, "q/n.stl")),
    );
    expect(read(join(h.dir, "p/m.stl"))).toBe("model");
    expect(h.open("hub_mass_delete")).toEqual([]);

    const p = (await h.send("GET", "/api/projects"))
      .json()
      .items.find((x: { folder: string }) => x.folder === "p");
    await until(async () =>
      (await h.send("GET", `/api/projects/${p.id}/devices`))
        .json()
        .devices.some((d: { slicers: unknown[] }) => d.slicers.length),
    );
    const res = await h.send("POST", `/api/projects/${p.id}/open`, {
      target: "device",
      deviceId: a.id,
      file: "m.stl",
    });
    expect(res.json()).toEqual({ ok: true });
    expect(started).toEqual([join(a.folder, "p", "m.stl")]);
    expect(read(join(a.folder, "p/m.stl"))).toBe("model");
    expect(existsSync(join(a.folder, "q/n.stl"))).toBe(false);

    // Open folder opens the synced copy; a project the device doesn't sync has none.
    const folder = (id: string) =>
      h.send("POST", `/api/projects/${id}/open`, { target: "folder", deviceId: a.id });
    expect((await folder(p.id)).json()).toEqual({ ok: true });
    expect(folders).toEqual([join(a.folder, "p")]);
    const q = (await h.send("GET", "/api/projects"))
      .json()
      .items.find((x: { folder: string }) => x.folder === "q");
    expect((await folder(q.id)).json().error.code).toBe("device_not_synced");

    // The slicer saves: the hub gets it.
    writeFileSync(join(a.folder, "p/m.stl"), "saved");
    await until(() => read(join(h.dir, "p/m.stl")) === "saved");
  }, 120_000);

  it("keeps two devices and the hub in sync through edits, renames, deletes and a conflict", async () => {
    const h = await hub();
    await h.put("p/a.txt", "one");
    const a = await device(h, "WS-A");
    const b = await device(h, "WS-B");
    await until(() => read(join(a.folder, "p/a.txt")) === "one");
    await until(() => read(join(b.folder, "p/a.txt")) === "one");

    // Edit on A → the hub and B.
    writeFileSync(join(a.folder, "p/a.txt"), "two");
    await until(() => read(join(h.dir, "p/a.txt")) === "two");
    await until(() => read(join(b.folder, "p/a.txt")) === "two");

    // Edit on the hub → both.
    await h.put("p/a.txt", "three");
    await until(() => read(join(a.folder, "p/a.txt")) === "three");
    await until(() => read(join(b.folder, "p/a.txt")) === "three");

    // Rename on A: the old name goes to the hub's trash, B follows.
    renameSync(join(a.folder, "p/a.txt"), join(a.folder, "p/b.txt"));
    await until(
      () => read(join(h.dir, "p/b.txt")) === "three" && !existsSync(join(h.dir, "p/a.txt")),
    );
    expect(readdirSync(join(h.dir, PROJECT_TRASH_DIR), { recursive: true }).join()).toMatch(
      /a\.txt/,
    );
    await until(() => read(join(b.folder, "p/b.txt")) === "three");
    await until(() => !existsSync(join(b.folder, "p/a.txt")));

    // Delete on B → trashed on the hub, gone on A.
    rmSync(join(b.folder, "p/b.txt"));
    await until(() => !existsSync(join(h.dir, "p/b.txt")));
    await until(() => !existsSync(join(a.folder, "p/b.txt")));

    // B edits while offline, A edits the same version meanwhile: A's wins, B's is a conflict copy.
    await h.put("p/c.txt", "base");
    await until(() => read(join(b.folder, "p/c.txt")) === "base");
    await until(() => read(join(a.folder, "p/c.txt")) === "base");
    b.link.close();
    writeFileSync(join(a.folder, "p/c.txt"), "from A");
    await until(() => read(join(h.dir, "p/c.txt")) === "from A");
    writeFileSync(join(b.folder, "p/c.txt"), "from B");
    const b2 = await device(h, "WS-B", "admin", b.dir);
    await until(() => read(join(b2.folder, "p/c.txt")) === "from A");
    const copy = () => readdirSync(join(h.dir, "p")).find((f) => f.includes("(conflict WS-B"));
    await until(() => !!copy());
    expect(read(join(h.dir, "p", copy() ?? ""))).toBe("from B");
    await until(() => read(join(a.folder, "p", copy() ?? "")) === "from B");
    await until(() => read(join(b2.folder, "p", copy() ?? "")) === "from B");
    expect(h.open("hub_conflict")).toHaveLength(1);
  }, 120_000);

  it("holds a mass delete until it is restored or confirmed", async () => {
    const h = await hub();
    await h.send("PATCH", "/api/preferences", { hubDeleteGuard: 3 });
    for (const n of [1, 2, 3, 4, 5]) await h.put(`p/${n}.txt`, `file ${n}`);
    const a = await device(h, "WS-A");
    await until(() => read(join(a.folder, "p/5.txt")) === "file 5");

    for (const n of [1, 2, 3, 4]) rmSync(join(a.folder, `p/${n}.txt`));
    await until(() => a.sync().state().state === "paused");
    expect(a.sync().state().held).toMatchObject([{ rootId: h.root.id, files: 4 }]);
    expect(existsSync(join(h.dir, "p/1.txt"))).toBe(true);
    await until(() => h.open("hub_mass_delete").length === 1);
    const [d] = (await h.send("GET", "/api/hub/devices")).json();
    expect(d.sync).toMatchObject({ state: "paused", held: [{ files: 4 }] });

    await a.sync().restore(h.root.id);
    await until(() => read(join(a.folder, "p/1.txt")) === "file 1");
    expect(a.sync().state().held).toEqual([]);
    await until(() => h.open("hub_mass_delete").length === 0);

    for (const n of [1, 2, 3, 4]) rmSync(join(a.folder, `p/${n}.txt`));
    await until(() => a.sync().state().state === "paused");
    await a.sync().confirm(h.root.id);
    await until(() => !existsSync(join(h.dir, "p/1.txt")) && !existsSync(join(h.dir, "p/4.txt")));
    expect(read(join(h.dir, "p/5.txt"))).toBe("file 5");
  }, 120_000);

  it("resumes without downloading again, and keeps download-only files read-only", async () => {
    const h = await hub();
    for (const n of [1, 2, 3]) await h.put(`p/${n}.txt`, `file ${n}`);
    const a = await device(h, "WS-A");
    await until(() => read(join(a.folder, "p/3.txt")) === "file 3");
    await a.sync().idle();
    const mtime = (n: number) => statSync(join(a.folder, `p/${n}.txt`)).mtimeMs;
    const before = [mtime(1), mtime(2), mtime(3)];

    // Killed (no goodbye), the hub changes one file meanwhile.
    a.link.close();
    await h.put("p/3.txt", "file 3 v2");
    const again = await device(h, "WS-A", "admin", a.dir);
    await until(() => read(join(again.folder, "p/3.txt")) === "file 3 v2");
    await again.sync().idle();
    expect([mtime(1), mtime(2)]).toEqual(before.slice(0, 2));

    // A viewer may only download: read-only, and a delete comes back.
    const v = await device(h, "WS-V", "viewer");
    const file = join(v.folder, "p/1.txt");
    // Made read-only just after it lands.
    await until(() => read(file) === "file 1" && (statSync(file).mode & 0o222) === 0);
    rmSync(file, { force: true });
    await until(() => read(file) === "file 1");
    expect(existsSync(join(h.dir, "p/1.txt"))).toBe(true);
  }, 120_000);

  const writable = (p: string) => (statSync(p).mode & 0o200) !== 0;
  /** A fake slicer per device: each start is a new pid that runs while it's in `running`. */
  const slicer = (running: Set<number>, pids: { next: number }, keep: boolean) => ({
    find: async () => [
      {
        id: "bambu-studio",
        name: "Bambu Studio",
        version: "2",
        path: "bs",
        cmd: "bs",
        args: [],
        cli: { cmd: "bs", args: [] },
      },
    ],
    start: async () => {
      const pid = pids.next++;
      if (keep) running.add(pid);
      return pid;
    },
  });

  it("locks: Open checks a file out, others get it read-only, closing the slicer or Done editing releases it", async () => {
    const h = await hub();
    await h.send("PATCH", "/api/preferences", { hubLocks: "on" });
    await h.put("p/m.stl", "model");
    const running = new Set<number>();
    const pids = { next: 100 };
    const hooks = { alive: (pid: number) => running.has(pid), handoffMs: 50, pollMs: 50 };
    // A's slicer stays open; B's exits at once (handed to a slicer already running).
    const a = await device(h, "WS-A", "admin", undefined, slicer(running, pids, true), hooks);
    const b = await device(h, "WS-B", "admin", undefined, slicer(running, pids, false), hooks);
    const atA = join(a.folder, "p/m.stl");
    const atB = join(b.folder, "p/m.stl");
    await until(() => read(atA) === "model" && read(atB) === "model");
    const p = (await h.send("GET", "/api/projects"))
      .json()
      .items.find((x: { folder: string }) => x.folder === "p");
    const open = (deviceId: string) =>
      h.send("POST", `/api/projects/${p.id}/open`, { target: "device", deviceId, file: "m.stl" });
    await until(
      async () =>
        (await h.send("GET", `/api/projects/${p.id}/devices`))
          .json()
          .devices.filter((d: { slicers: unknown[] }) => d.slicers.length).length > 1,
    );

    expect((await open(a.id)).json()).toEqual({ ok: true });
    await until(() => !writable(atB) && a.sync().editing().length === 1);
    expect(writable(atA)).toBe(true);
    expect(() => writeFileSync(atB, "saved on B")).toThrow();
    expect((await h.send("GET", `/api/projects/${p.id}/locks`)).json()).toMatchObject([
      { file: "m.stl", device: "WS-A" },
    ]);
    // B opens it read-only; its slicer handed it on, which releases nothing.
    expect((await open(b.id)).json()).toEqual({
      ok: true,
      lockedBy: { user: "admin", device: "WS-A" },
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(writable(atB)).toBe(false);

    // A's slicer closes: the lock goes, B may edit again.
    running.clear();
    await until(() => writable(atB) && a.sync().editing().length === 0);

    // A's first save checks it out again; Done editing on the status page releases it.
    writeFileSync(atA, "saved on A");
    await until(() => read(atB) === "saved on A" && !writable(atB));
    const [editing] = a.sync().editing();
    expect(editing).toMatchObject({ path: "p/m.stl" });
    await a.sync().done(editing?.key ?? "");
    await until(() => writable(atB));
    expect((await h.send("GET", `/api/projects/${p.id}/locks`)).json()).toEqual([]);
  }, 120_000);

  it("strict locks: offline, only the files checked out here stay writable", async () => {
    const h = await hub();
    await h.send("PATCH", "/api/preferences", { hubLocks: "strict" });
    await h.put("p/mine.stl", "one");
    await h.put("p/other.stl", "two");
    const a = await device(h, "WS-A");
    const mine = join(a.folder, "p/mine.stl");
    const other = join(a.folder, "p/other.stl");
    await until(() => read(mine) === "one" && read(other) === "two");
    writeFileSync(mine, "edited");
    await until(() => a.sync().editing().length === 1);

    a.link.close();
    await until(() => !writable(other));
    expect(writable(mine)).toBe(true);

    a.link.start();
    await until(() => a.link.state().status === "online" && writable(other));
    expect(read(join(h.dir, "p/mine.stl"))).toBe("edited");
  }, 120_000);
});
