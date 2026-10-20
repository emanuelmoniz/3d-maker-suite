import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let id: string;
let folder: string;

const root = () => join(dir, "models");
const outside = () => join(dir, "outside");
const files = (path = "") =>
  app.inject(`/api/projects/${id}/files?${new URLSearchParams({ path })}`);
const names = async (path = "") =>
  (await files(path)).json().entries.map((e: { name: string }) => e.name);
const upload = (path: string, body: string | Buffer | Readable, replace = false) =>
  app.inject({
    method: "PUT",
    url: `/api/projects/${id}/files/content?${new URLSearchParams({ path, replace: String(replace) })}`,
    headers: { "content-type": "application/octet-stream" },
    payload: body,
  });
const mkdirApi = (path: string) =>
  app.inject({ method: "POST", url: `/api/projects/${id}/files/folders`, payload: { path } });
const move = (from: string, to: string) =>
  app.inject({ method: "POST", url: `/api/projects/${id}/files/move`, payload: { from, to } });
const del = (path: string) =>
  app.inject({
    method: "DELETE",
    url: `/api/projects/${id}/files?${new URLSearchParams({ path })}`,
  });
const setPrefs = (payload: object) =>
  app.inject({ method: "PATCH", url: "/api/preferences", payload });
const create = (payload: object) => app.inject({ method: "POST", url: "/api/projects", payload });
const project = async () => (await app.inject(`/api/projects/${id}`)).json();
async function scan() {
  await app.inject({ method: "POST", url: "/api/projects/scan" });
  await expect.poll(async () => (await app.inject("/api/projects/scan")).json().state).toBe("idle");
}

async function boot(opts: { watchProjects?: boolean } = {}) {
  app = await buildApp(openDb(":memory:"), false, join(dir, "data"), opts);
  await setPrefs({ projectRoots: [root()] });
  const res = await create({ name: "Boat Test", createFolder: true });
  expect(res.statusCode).toBe(201);
  ({ id, folderPath: folder } = res.json());
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "project-files-"));
  await Promise.all([root(), outside(), join(dir, "data")].map((d) => mkdir(d)));
  await writeFile(join(outside(), "secret.txt"), "outside");
  await boot();
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("new project folder", () => {
  it("creates <root>/<number>_<name> and makes it the project's folder", async () => {
    expect(folder).toBe(join(root(), "001_Boat Test"));
    expect(existsSync(folder)).toBe(true);
    expect(await project()).toMatchObject({ number: 1, name: "Boat Test", folderPath: folder });
    // Illegal characters become dashes.
    const res = await create({ name: 'Cat: "Vase"?', number: 7, createFolder: true });
    expect(res.json().folderPath).toBe(join(root(), "007_Cat- -Vase--"));
  });

  it("needs a configured root, picked when there are several", async () => {
    const second = join(dir, "more");
    await mkdir(second);
    await setPrefs({ projectRoots: [root(), second] });
    expect((await create({ name: "A", createFolder: true })).json().error.code).toBe(
      "root_required",
    );
    expect((await create({ name: "A", createFolder: true, root: outside() })).statusCode).toBe(400);
    const res = await create({ name: "A", createFolder: true, root: second });
    expect(res.json().folderPath).toBe(join(second, "002_A"));
    await setPrefs({ projectRoots: [] });
    expect((await create({ name: "B", createFolder: true })).statusCode).toBe(409);
  });

  it("refuses an existing folder and leaves it alone", async () => {
    await mkdir(join(root(), "005_Taken"));
    await writeFile(join(root(), "005_Taken", "keep.txt"), "x");
    const res = await create({ name: "Taken", number: 5, createFolder: true });
    expect(res.json().error.code).toBe("folder_exists");
    expect(existsSync(join(root(), "005_Taken", "keep.txt"))).toBe(true);
  });
});

describe("path guard", () => {
  it("refuses traversal, absolute, Windows-style, hidden and device paths", async () => {
    for (const path of [
      "../x",
      "a/../../x",
      "./x",
      "/etc/passwd",
      "C:\\x",
      "C:/x",
      "a\\..\\x",
      "\\\\server\\share",
      ".hidden",
      "a//b",
      "CON",
      "nul.txt",
      "x.",
      "file.txt:stream",
    ]) {
      const res = await upload(path, "x");
      expect(res.statusCode, path).toBe(400);
      expect(res.json().error.code, path).toBe("invalid_path");
      expect((await files(path)).statusCode, path).toBe(400);
    }
    expect(readdirSync(dir).sort()).toEqual(["data", "models", "outside"]);
    expect(readdirSync(outside())).toEqual(["secret.txt"]);
  });

  it("refuses to go through a symlink or junction that leaves the folder", async () => {
    await symlink(outside(), join(folder, "link"), "junction");
    expect((await files("link")).statusCode).toBe(403);
    expect((await upload("link/new.txt", "x")).statusCode).toBe(403);
    expect((await mkdirApi("link/sub")).statusCode).toBe(403);
    expect((await move("link/secret.txt", "stolen.txt")).statusCode).toBe(403);
    expect((await del("link/secret.txt")).statusCode).toBe(403);
    expect((await del("link")).statusCode).toBe(403);
    expect((await move("link", "renamed")).statusCode).toBe(403);
    expect(readdirSync(outside())).toEqual(["secret.txt"]);
    // The link itself isn't listed.
    expect(await names()).toEqual([]);
  });

  it("refuses every route once the project folder is no longer in a root", async () => {
    await upload("a.txt", "x");
    await setPrefs({ projectRoots: [outside()] });
    for (const res of [
      await files(),
      await upload("b.txt", "x"),
      await mkdirApi("sub"),
      await move("a.txt", "c.txt"),
      await del("a.txt"),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("not_allowed");
    }
  });
});

describe("files", () => {
  it("lists folders first, without hidden entries", async () => {
    await mkdirApi("zeta");
    await upload("alpha.txt", "abc");
    await writeFile(join(folder, ".hidden"), "x");
    const body = (await files()).json();
    expect(body.entries).toMatchObject([
      { name: "zeta", path: "zeta", type: "dir", size: 0 },
      { name: "alpha.txt", path: "alpha.txt", type: "file", size: 3 },
    ]);
    await upload("zeta/in.txt", "x");
    expect((await files("zeta")).json().entries[0].path).toBe("zeta/in.txt");
    expect((await files("alpha.txt")).statusCode).toBe(400);
    expect((await files("missing")).statusCode).toBe(404);
  });

  it("uploads, refuses to overwrite unless asked, and replaces when asked", async () => {
    expect((await upload("part.stl", "solid one")).statusCode).toBe(201);
    const again = await upload("part.stl", "solid two");
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("path_exists");
    expect(await readFile(join(folder, "part.stl"), "utf8")).toBe("solid one");
    expect((await upload("part.stl", "solid two", true)).statusCode).toBe(200);
    expect(await readFile(join(folder, "part.stl"), "utf8")).toBe("solid two");
    // A folder is never replaced by a file.
    await mkdirApi("sub");
    expect((await upload("sub", "x", true)).statusCode).toBe(409);
    expect((await upload("missing/a.txt", "x")).statusCode).toBe(404);
    expect((await upload("empty.md", "")).statusCode).toBe(201);
    expect(await readFile(join(folder, "empty.md"), "utf8")).toBe("");
  });

  it("refuses an upload over the size limit and leaves nothing behind", async () => {
    await setPrefs({ projectUploadMaxMb: 0.001 }); // 1048 bytes
    const big = Buffer.alloc(2000, 1);
    const res = await upload("big.bin", big);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("file_too_large");
    // Without a length up front, it's counted while streaming.
    expect((await upload("big.bin", Readable.from([big.subarray(0, 1000), big]))).statusCode).toBe(
      413,
    );
    expect(readdirSync(folder)).toEqual([]);
    expect((await upload("small.bin", Buffer.alloc(1000))).statusCode).toBe(201);
  });

  it("creates folders but never over an existing name", async () => {
    expect((await mkdirApi("a")).statusCode).toBe(201);
    expect((await mkdirApi("a/b")).statusCode).toBe(201);
    expect((await mkdirApi("a")).statusCode).toBe(409);
    expect((await mkdirApi("x/y")).statusCode).toBe(404);
  });

  it("renames and moves, never onto an existing file or folder", async () => {
    await upload("a.txt", "A");
    await upload("b.txt", "B");
    await mkdirApi("dir");
    await mkdirApi("other");
    for (const [from, to] of [
      ["a.txt", "b.txt"],
      ["a.txt", "dir"],
      ["dir", "other"],
      ["dir", "b.txt"],
    ]) {
      const res = await move(from as string, to as string);
      expect(res.statusCode, `${from} -> ${to}`).toBe(409);
      expect(res.json().error.code).toBe("path_exists");
    }
    expect(await readFile(join(folder, "b.txt"), "utf8")).toBe("B");
    expect((await move("dir", "dir/inside")).statusCode).toBe(400);

    expect((await move("a.txt", "c.txt")).json()).toEqual({ path: "c.txt" });
    expect((await move("c.txt", "dir/c.txt")).statusCode).toBe(200);
    expect((await move("dir", "other/dir")).statusCode).toBe(200);
    expect(await readFile(join(folder, "other", "dir", "c.txt"), "utf8")).toBe("A");
    // A change of letter case only is a rename, not a clash.
    expect((await move("b.txt", "B.txt")).statusCode).toBe(200);
    expect(await names()).toEqual(["other", "B.txt"]);
  });

  it("deletes into the root's trash, which can be counted and emptied", async () => {
    await mkdirApi("sub");
    await upload("sub/a.txt", "abc");
    await upload("b.txt", "de");
    expect((await del("sub")).statusCode).toBe(204);
    expect((await del("b.txt")).statusCode).toBe(204);
    expect((await del("b.txt")).statusCode).toBe(404);
    expect(await names()).toEqual([]);

    const trash = join(root(), ".3d-maker-suite-trash");
    const entries = readdirSync(trash);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.endsWith("_001_Boat Test"))).toBe(true);
    expect((await app.inject("/api/projects/trash")).json()).toEqual({ items: 2, bytes: 5 });
    // A scan doesn't make projects out of the trash.
    await upload("model.stl", "solid");
    await scan();
    expect((await app.inject("/api/projects")).json().total).toBe(1);

    expect((await app.inject({ method: "DELETE", url: "/api/projects/trash" })).statusCode).toBe(
      204,
    );
    expect(existsSync(trash)).toBe(false);
    expect((await app.inject("/api/projects/trash")).json()).toEqual({ items: 0, bytes: 0 });
    expect(await names()).toEqual(["model.stl"]);
  });
});

describe("scanner", () => {
  it("picks up every change right away", async () => {
    const paths = async () =>
      (await project()).meta.files.map((f: { path: string }) => f.path).sort();
    await upload("part.stl", "solid");
    expect(await paths()).toEqual(["part.stl"]);
    expect((await project()).filePath).toBe(join(folder, "part.stl"));
    await mkdirApi("models");
    await move("part.stl", "models/part.stl");
    expect(await paths()).toEqual(["models/part.stl"]);
    await del("models");
    expect(await paths()).toEqual([]);
  });

  it("keeps the linked description file linked when it moves, and unlinks it when deleted", async () => {
    await upload("README.md", "A boat.");
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${id}`,
      payload: { descriptionFile: "README.md" },
    });
    await mkdirApi("docs");
    await move("README.md", "docs/README.md");
    expect(await project()).toMatchObject({
      descriptionFile: "docs/README.md",
      description: "A boat.",
    });
    await del("docs");
    expect(await project()).toMatchObject({ descriptionFile: null });
  });

  it("watched project folders stay movable through the API", async () => {
    await app.close();
    await rm(root(), { recursive: true, force: true });
    await mkdir(root());
    await boot({ watchProjects: true });
    await mkdirApi("images");
    await upload("images/cover.png", "png"); // a watch on a subfolder is what locks a folder
    await upload("vase.stl", "solid");
    await scan(); // the watcher starts after a scan
    await new Promise((r) => setTimeout(r, 1000)); // let the watcher settle
    expect((await move("images", "pictures")).statusCode).toBe(200); // EPERM if locked
    // And the project folder itself can still be renamed by hand.
    await rename(folder, join(root(), "001_Pot"));
    await expect
      .poll(
        async () =>
          (await app.inject("/api/projects"))
            .json()
            .items.some((p: { folderPath: string }) => p.folderPath === join(root(), "001_Pot")),
        { timeout: 10_000, interval: 200 },
      )
      .toBe(true);
  }, 15_000);
});
