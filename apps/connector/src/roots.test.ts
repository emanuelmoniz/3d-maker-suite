// The connector's side of the hub's file requests, against a fake hub: only its own roots, and no
// path out of them.
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEvent, SharedFolder } from "@3d-maker-suite/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRootSync, type Request, type RootSync } from "./roots.ts";
import { openStore, type Store } from "./state.ts";

let dir: string;
let base: string;
let outside: string;
let sync: RootSync;
let store: Store;
let data: string;
const rootId = randomUUID();
let sent: { path: string; body?: unknown; sha256?: string; data?: Buffer }[];
/** What the fake hub's `GET /roots` answers: paths and project counts. */
let roots: { id: string; path: string; projects: number }[];
/** The fake hub's shared folders for this device: null until the connector sends its own. */
let hubFolders: SharedFolder[] | null;
let request: Request;
/** The folders the fake hub asks for on an index. */
let want: string[];
/** What the fake hub sends for an `fs.write`. */
let upload: Buffer;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "connector-roots-")));
  base = join(dir, "root");
  outside = join(dir, "outside");
  await mkdir(join(base, "001_Box"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(base, "001_Box", "box.3mf"), "box");
  await writeFile(join(outside, "secret.3mf"), "secret");
  await symlink(outside, join(base, "out"), "junction");
  sent = [];
  want = [];
  upload = Buffer.alloc(0);
  roots = [{ id: rootId, path: base, projects: 1 }];
  hubFolders = null;
  request = async (path, init) => {
    if (path === "/roots")
      return Response.json(
        roots.map((r) => ({
          ...r,
          projectDepth: 1,
          filesDepth: null,
          maxFiles: 500,
          folderMaxMb: 32,
          covers: {},
          galleries: {},
        })),
      );
    // An `fs.write`'s bytes, from the hub.
    if (path.startsWith("/files/") && !init?.method) return new Response(new Uint8Array(upload));
    const file = init?.file;
    const chunks: Buffer[] = [];
    for await (const chunk of file?.stream ?? []) chunks.push(chunk as Buffer);
    const data = file && Buffer.concat(chunks);
    sent.push({ path, body: init?.body, sha256: file?.sha256, data });
    if (path === "/folders") {
      hubFolders ??= init?.body as SharedFolder[];
      return Response.json(hubFolders);
    }
    if (path.endsWith("/index")) return Response.json({ want });
    return new Response(null, { status: 204 });
  };
  // Apart from `dir`: a test checks nothing else is in it.
  data = await mkdtemp(join(tmpdir(), "connector-state-"));
  store = openStore(data);
  store.set({ sharedFolders: [{ path: base, paused: false }] });
  sync = createRootSync({ request, log: () => {}, store, dataDir: data });
  await sync.start();
});
afterEach(async () => {
  sync.stop();
  await rm(dir, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
});

/** A request event without its id (each member of the union on its own). */
type Asked<E = Extract<HubEvent, { requestId: string }>> = E extends unknown
  ? Omit<E, "requestId">
  : never;

/** Sends a request event; resolves with what the connector sent back. */
async function ask(event: Asked) {
  const requestId = randomUUID();
  sync.handle({ ...event, requestId } as HubEvent);
  for (let i = 0; i < 250 && !sent.some((s) => s.path.endsWith(requestId)); i++)
    await new Promise((r) => setTimeout(r, 20));
  const reply = sent.find((s) => s.path.endsWith(requestId));
  if (!reply) throw new Error("no answer");
  return reply;
}
const failed = (code: string) => ({ body: { ok: false, code } });

describe("device root requests", () => {
  it("sends a file of its root with its sha256", async () => {
    const reply = await ask({ type: "fs.upload", rootId, rel: "001_Box/box.3mf" });
    expect(reply.path).toMatch(/^\/files\//);
    expect(reply.data?.toString()).toBe("box");
    expect(reply.sha256).toBe(createHash("sha256").update("box").digest("hex"));
  });

  it("refuses paths out of the root, and roots it doesn't have", async () => {
    expect(await ask({ type: "fs.upload", rootId, rel: "../outside/secret.3mf" })).toMatchObject(
      failed("EINVAL"),
    );
    expect(await ask({ type: "fs.upload", rootId, rel: "out/secret.3mf" })).toMatchObject(
      failed("ENOENT"),
    );
    expect(
      await ask({ type: "fs.upload", rootId, rel: join(outside, "secret.3mf") }),
    ).toMatchObject(failed("EINVAL"));
    expect(await ask({ type: "fs.upload", rootId, rel: "001_Box" })).toMatchObject(
      failed("ENOENT"),
    );
    expect(
      await ask({ type: "fs.upload", rootId: randomUUID(), rel: "001_Box/box.3mf" }),
    ).toMatchObject(failed("ENOENT"));
    expect(await ask({ type: "fs.mkdir", rootId, rel: "out/new" })).toMatchObject(failed("ENOENT"));
    expect(await ask({ type: "fs.mkdir", rootId, rel: "../new" })).toMatchObject(failed("EINVAL"));
    expect(await ask({ type: "fs.trash", rootId, rel: "out", as: "x" })).toMatchObject(
      failed("ENOENT"),
    );
    expect(await ask({ type: "fs.trash", rootId, rel: "001_Box", as: "../x" })).toMatchObject(
      failed("EINVAL"),
    );
    expect(await readdir(outside)).toEqual(["secret.3mf"]);
    expect(await readdir(dir)).toEqual(["outside", "root"]);
  });

  it("makes and trashes folders inside its root", async () => {
    expect(await ask({ type: "fs.mkdir", rootId, rel: "002_Cup" })).toMatchObject({
      body: { ok: true, result: null },
    });
    expect(await ask({ type: "fs.mkdir", rootId, rel: "002_Cup" })).toMatchObject(failed("EEXIST"));
    const trashed = await ask({ type: "fs.trash", rootId, rel: "001_Box", as: "stamp_001_Box" });
    const to = join(base, ".3d-maker-suite-trash", "stamp_001_Box");
    expect(trashed.body).toEqual({ ok: true, result: { path: to } });
    expect(await readFile(join(to, "box.3mf"), "utf8")).toBe("box");
  });
});

describe("writes from the web", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  /** An `fs.write` of `text`, as the hub sends it. */
  const write = (rel: string, text: string, base: string | null, keep = 2, hash = sha(text)) => {
    upload = Buffer.from(text);
    return ask({ type: "fs.write", rootId, rel, sha256: hash, base, by: "Ann", keep });
  };
  const done = (status: string, path: string) => ({
    body: { ok: true, result: { status, path } },
  });

  it("writes a new file, replaces one still at its base and keeps the old one in its data folder", async () => {
    const at = join(base, "001_Box");
    expect(await write("001_Box/new.stl", "new", null)).toMatchObject(
      done("updated", "001_Box/new.stl"),
    );
    expect(await readFile(join(at, "new.stl"), "utf8")).toBe("new");
    for (const [text, prev] of [
      ["v2", "box"],
      ["v3", "v2"],
      ["v4", "v3"],
    ] as const)
      expect(await write("001_Box/box.3mf", text, sha(prev))).toMatchObject(
        done("updated", "001_Box/box.3mf"),
      );
    expect(await readFile(join(at, "box.3mf"), "utf8")).toBe("v4");
    // Nothing else in the root: the versions are in the data folder, the newest 2.
    expect((await readdir(at)).sort()).toEqual(["box.3mf", "new.stl"]);
    const v3 = await ask({ type: "fs.upload", rootId, rel: "001_Box/box.3mf", version: 3 });
    expect(v3.data?.toString()).toBe("v3");
    expect(
      await ask({ type: "fs.upload", rootId, rel: "001_Box/box.3mf", version: 1 }),
    ).toMatchObject(failed("ENOENT"));

    // The folder goes with each file's hash and its kept versions.
    want = ["001_Box"];
    sent = [];
    await sync.start();
    const folder = sent.find((s) => s.path.endsWith("/folders"))?.body as {
      scan: { files: { path: string; sha256?: string; versions?: { version: number }[] }[] };
    };
    expect(folder.scan.files.find((f) => f.path === "box.3mf")).toMatchObject({
      sha256: sha("v4"),
      versions: [{ version: 2 }, { version: 3 }],
    });
    expect(folder.scan.files.find((f) => f.path === "new.stl")?.versions).toBeUndefined();
  });

  it("keeps the upload as a conflict copy when the file changed since its base", async () => {
    const at = join(base, "001_Box");
    // The page listed other bytes, or no file there at all.
    for (const listed of [sha("older"), null]) {
      const reply = await write("001_Box/box.3mf", "mine", listed);
      const path = (reply.body as { result: { path: string } }).result.path;
      expect(reply).toMatchObject(done("conflict", path));
      expect(path).toMatch(/^001_Box\/box \(conflict Ann [\d -]+\)\.3mf$/);
      expect(await readFile(join(base, ...path.split("/")), "utf8")).toBe("mine");
    }
    expect(await readFile(join(at, "box.3mf"), "utf8")).toBe("box");
    expect(await readdir(at)).toHaveLength(3);
  });

  it("refuses paths out of the root, a folder and damaged bytes", async () => {
    expect(await write("../x.stl", "x", null)).toMatchObject(failed("EINVAL"));
    expect(await write("out/x.stl", "x", null)).toMatchObject(failed("ENOENT"));
    expect(await write(join(outside, "x.stl"), "x", null)).toMatchObject(failed("EINVAL"));
    expect(await write("001_Box", "x", null)).toMatchObject(failed("EEXIST"));
    expect(await write("001_Box/box.3mf", "x", sha("box"), 2, sha("y"))).toMatchObject(
      failed("EIO"),
    );
    expect(await readdir(outside)).toEqual(["secret.3mf"]);
    // No part file left behind, the file as it was.
    const at = join(base, "001_Box");
    expect(await readdir(at)).toEqual(["box.3mf"]);
    expect(await readFile(join(at, "box.3mf"), "utf8")).toBe("box");
  });
});

describe("shared folders", () => {
  it("sends the list it kept itself on connect, then keeps the hub's (ADR-0021)", async () => {
    store.set({ sharedFolders: undefined, folders: [base] });
    sent = [];
    await sync.start(true);
    expect(sent[0]).toMatchObject({ path: "/folders", body: [{ path: base, paused: false }] });
    expect(store.get()).toMatchObject({ sharedFolders: [{ path: base, paused: false }] });
    expect(store.get().folders).toBeUndefined();
    expect(sync.state().watching).toBe(1);
    // The hub's list wins: its root is outside it now.
    hubFolders = [{ path: outside, paused: false }];
    sent = [];
    await sync.start(true);
    expect(store.get().sharedFolders).toEqual(hubFolders);
    expect(sent).toMatchObject([
      { path: "/folders" },
      { path: `/roots/${rootId}/index`, body: { state: "unshared" } },
    ]);
  });

  it("keeps its saved list when the hub doesn't answer it", async () => {
    const down: Request = (path, init) =>
      path === "/folders"
        ? Promise.resolve(new Response(null, { status: 503 }))
        : request(path, init);
    const other = createRootSync({ request: down, log: () => {}, store });
    await other.start(true);
    expect(store.get().sharedFolders).toEqual([{ path: base, paused: false }]);
    expect(other.state().watching).toBe(1);
    other.stop();
  });

  it("lets the hub list folders anywhere, names only", async () => {
    expect((await ask({ type: "fs.list", path: null })).body).toMatchObject({ ok: true });
    expect(await ask({ type: "fs.list", path: dir })).toMatchObject({
      body: { ok: true, result: { path: dir, entries: [{ name: "outside" }, { name: "root" }] } },
    });
    // Folders only: the file inside isn't listed.
    expect(await ask({ type: "fs.list", path: outside })).toMatchObject({
      body: { ok: true, result: { entries: [] } },
    });
  });

  it("reports a root outside them as unshared and serves none of it", async () => {
    store.set({ sharedFolders: [{ path: outside, paused: false }] });
    sent = [];
    await sync.start();
    expect(sent).toMatchObject([{ path: `/roots/${rootId}/index`, body: { state: "unshared" } }]);
    expect(sync.state().watching).toBe(0);
    expect(await ask({ type: "fs.upload", rootId, rel: "001_Box/box.3mf" })).toMatchObject(
      failed("ENOENT"),
    );
  });

  it("treats a paused folder as not shared, on the hub's folders.set", async () => {
    store.set({ sharedFolders: [{ path: base, paused: true }] });
    sent = [];
    sync.handle({ type: "folders.set", folders: [{ path: base, paused: true }] });
    await sync.idle();
    await sync.idle();
    expect(sent).toMatchObject([{ path: `/roots/${rootId}/index`, body: { state: "unshared" } }]);
    expect(await ask({ type: "fs.mkdir", rootId, rel: "002_Cup" })).toMatchObject(failed("ENOENT"));
    // Share to the hub off: none is shared, the list stays.
    store.set({ sharedFolders: [{ path: base, paused: false }], shareProjects: false });
    sent = [];
    await sync.start();
    expect(sent).toMatchObject([{ path: `/roots/${rootId}/index`, body: { state: "unshared" } }]);
  });
});
