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
import type { HubEvent } from "@3d-maker-suite/core";
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
let request: Request;

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
  roots = [{ id: rootId, path: base, projects: 1 }];
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
    const file = init?.file;
    const chunks: Buffer[] = [];
    for await (const chunk of file?.stream ?? []) chunks.push(chunk as Buffer);
    const data = file && Buffer.concat(chunks);
    sent.push({ path, body: init?.body, sha256: file?.sha256, data });
    if (path.endsWith("/index")) return Response.json({ want: [] });
    return new Response(null, { status: 204 });
  };
  // Apart from `dir`: a test checks nothing else is in it.
  data = await mkdtemp(join(tmpdir(), "connector-state-"));
  store = openStore(data);
  sync = createRootSync({ request, log: () => {}, store });
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

describe("shared folders", () => {
  it("seeds them from its roots on the first fetch, outermost only", async () => {
    expect(store.get().folders).toEqual([base]);
    store.set({ folders: undefined });
    roots = [
      { id: randomUUID(), path: join(base, "001_Box"), projects: 0 },
      { id: rootId, path: base, projects: 1 },
    ];
    await sync.start();
    expect(store.get().folders).toEqual([base]);
    // Seeded once: an empty list stays empty.
    store.set({ folders: [] });
    await sync.start();
    expect(store.get().folders).toEqual([]);
  });

  it("lets the hub list only inside them, also through `..` and links", async () => {
    expect(await ask({ type: "fs.list", path: null })).toMatchObject({
      body: { ok: true, result: { entries: [{ path: base }] } },
    });
    expect(await ask({ type: "fs.list", path: base })).toMatchObject({
      body: { ok: true, result: { path: base, parent: null } },
    });
    for (const path of [dir, outside, join(base, ".."), join(base, "out")])
      expect(await ask({ type: "fs.list", path })).toMatchObject(failed("EACCES"));
  });

  it("reports a root outside them as unshared and serves none of it", async () => {
    store.set({ folders: [outside] });
    sent = [];
    await sync.start();
    expect(sent).toMatchObject([{ path: `/roots/${rootId}/index`, body: { state: "unshared" } }]);
    expect(sync.state().watching).toBe(0);
    expect(await ask({ type: "fs.upload", rootId, rel: "001_Box/box.3mf" })).toMatchObject(
      failed("ENOENT"),
    );
  });

  it("adds a folder that covers others, and keeps one holding a root with projects", async () => {
    expect(await sync.folders.add("relative")).toBe("notAbsolute");
    expect(await sync.folders.add(join(dir, "nope"))).toBe("notFound");
    expect(await sync.folders.add(join(base, "001_Box"))).toBe("covered");
    expect(await sync.folders.add(dir)).toBeUndefined();
    expect(sync.folders.list()).toEqual([dir]);
    expect(await sync.folders.remove(dir)).toBe("inUse");
    // Asked of the hub at the time, not as it was on the last sync.
    roots = [{ id: rootId, path: base, projects: 0 }];
    expect(await sync.folders.remove(dir)).toBeUndefined();
    expect(sync.folders.list()).toEqual([]);
    await sync.idle();
    expect(sync.state().watching).toBe(0);
  });

  it("waits for the hub before a change", async () => {
    const other = openStore(join(data, "other"));
    const offline: Request = async () => {
      throw new Error("offline");
    };
    const waiting = createRootSync({ request: offline, log: () => {}, store: other });
    expect(await waiting.folders.add(base)).toBe("waiting");
    other.set({ folders: [base] });
    expect(await waiting.folders.remove(base)).toBe("waiting");
  });
});
