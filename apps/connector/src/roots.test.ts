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

let dir: string;
let base: string;
let outside: string;
let sync: RootSync;
const rootId = randomUUID();
let sent: { path: string; body?: unknown; sha256?: string; data?: Buffer }[];

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
  const request: Request = async (path, init) => {
    if (path === "/roots")
      return Response.json([
        { id: rootId, path: base, projectDepth: 1, filesDepth: null, maxFiles: 500, covers: {} },
      ]);
    if (path.endsWith("/index")) return Response.json({ want: [] });
    const file = init?.file;
    const chunks: Buffer[] = [];
    for await (const chunk of file?.stream ?? []) chunks.push(chunk as Buffer);
    const data = file && Buffer.concat(chunks);
    sent.push({ path, body: init?.body, sha256: file?.sha256, data });
    return new Response(null, { status: 204 });
  };
  sync = createRootSync({ request, log: () => {} });
  await sync.start();
});
afterEach(async () => {
  sync.stop();
  await rm(dir, { recursive: true, force: true });
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
