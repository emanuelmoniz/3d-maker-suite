import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.ts";
import { setRoots } from "../testRoots.ts";

const scanned: string[] = [];
vi.mock("./scanFolder.ts", async (orig) => {
  const mod = await orig<typeof import("./scanFolder.ts")>();
  return {
    ...mod,
    scanFolder: (folder: string, ...rest: [(string | null)?, number?, (number | null)?]) => {
      scanned.push(folder);
      return mod.scanFolder(folder, ...rest);
    },
  };
});

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const root = () => join(dir, "models");
const put = async (path: string, content = "solid") => {
  await mkdir(join(root(), path, ".."), { recursive: true });
  await writeFile(join(root(), path), content);
};
const settle = (ms = 4500) => new Promise((r) => setTimeout(r, ms)); // debounce is 3 s
const idle = async () => {
  for (;;) {
    const s = (await app.inject("/api/projects/scan")).json();
    if (s.state === "idle" && s.finishedAt) return s;
    await new Promise((r) => setTimeout(r, 10));
  }
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scanner-"));
  await mkdir(join(dir, "data"));
  await put("A/a.stl");
  await put("B/b.stl");
  await mkdir(join(root(), "A", "x", "y"), { recursive: true });
  app = await buildApp(openDb(":memory:"), false, join(dir, "data"), { watchProjects: true });
  await setRoots(app, { path: root(), filesDepth: 1 });
  await app.inject({ method: "POST", url: "/api/projects/scan" });
  await idle();
  await settle(1000);
  scanned.length = 0;
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("project watcher", () => {
  it("one click is one pass, even if another request arrives while it runs", async () => {
    await app.inject({ method: "POST", url: "/api/projects/scan" });
    await app.inject({ method: "POST", url: "/api/projects/scan" });
    await idle();
    await settle();
    expect(scanned.sort()).toEqual([join(root(), "A"), join(root(), "B")]);
  }, 15_000);

  it("a change scans only the project folder it is in", async () => {
    await put("A/extra.stl");
    await settle();
    expect(scanned).toEqual([join(root(), "A")]);
  }, 15_000);

  it("a change deeper than the root's files depth scans nothing", async () => {
    await put("A/x/y/deep.stl"); // files depth 1: A/x is listed, A/x/y is not
    await settle();
    expect(scanned).toEqual([]);
    await put("A/x/ok.stl");
    await settle();
    expect(scanned).toEqual([join(root(), "A")]);
  }, 20_000);

  it("a new folder is picked up without re-scanning the others", async () => {
    await put("C/c.stl");
    await settle();
    expect(scanned).toEqual([join(root(), "C")]);
    const items = (await app.inject("/api/projects?sort=name")).json().items;
    expect(items.map((p: { name: string }) => p.name)).toEqual(["A", "B", "C"]);
  }, 15_000);

  it("a write made by the app scans its folder once", async () => {
    const { id } = (await app.inject("/api/projects?sort=name")).json().items[0];
    const up = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}/files/content?path=notes.txt`,
      payload: "hi",
      headers: { "content-type": "application/octet-stream" },
    });
    expect(up.statusCode).toBe(201);
    await settle();
    expect(scanned).toEqual([join(root(), "A")]);
  }, 15_000);
});
