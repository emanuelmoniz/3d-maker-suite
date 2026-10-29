import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listShared } from "./listFolder.ts";
import { inRoot, relParts, rootMkdir, rootTrash, within } from "./rootPath.ts";

let dir: string;
let base: string;
let outside: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "root-path-")));
  base = join(dir, "root");
  outside = join(dir, "outside");
  await mkdir(join(base, "001_Box"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(base, "001_Box", "box.3mf"), "x");
  await writeFile(join(outside, "secret.3mf"), "x");
  // A junction on Windows: no admin rights needed.
  await symlink(outside, join(base, "out"), "junction");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: NodeJS.ErrnoException) => e.code,
  );

describe("root paths", () => {
  it("refuses `..`, absolute paths and empty segments", () => {
    for (const rel of ["..", "a/../b", "/etc/passwd", "C:/x", "a//b", "./a", "a/", "a\0b"])
      expect(() => relParts(rel), rel).toThrow(expect.objectContaining({ code: "EINVAL" }));
    expect(relParts("")).toEqual([]);
    expect(relParts("001_Box/box.3mf")).toEqual(["001_Box", "box.3mf"]);
  });

  it("resolves inside the root only, also through links", async () => {
    expect(await inRoot(base, "")).toBe(base);
    expect(await inRoot(base, "001_Box/box.3mf")).toBe(join(base, "001_Box", "box.3mf"));
    expect(await inRoot(base, "nope")).toBeNull();
    expect(await inRoot(base, "out/secret.3mf")).toBeNull();
    await expect(inRoot(base, "../outside/secret.3mf")).rejects.toMatchObject({ code: "EINVAL" });
  });

  it("makes a folder whose parent is in the root", async () => {
    await rootMkdir(base, "002_Cup");
    expect(await code(rootMkdir(base, "002_Cup"))).toBe("EEXIST");
    expect(await code(rootMkdir(base, "no/such"))).toBe("ENOENT");
    expect(await code(rootMkdir(base, "out/x"))).toBe("ENOENT");
    expect(await code(rootMkdir(base, "../x"))).toBe("EINVAL");
    expect(await readdir(outside)).toEqual(["secret.3mf"]);
  });

  it("trashes inside the root only", async () => {
    const to = await rootTrash(base, "001_Box", ".trash", "stamp_001_Box");
    expect(to).toBe(join(base, ".trash", "stamp_001_Box"));
    expect(await readdir(to)).toEqual(["box.3mf"]);
    expect(await code(rootTrash(base, "", ".trash", "x"))).toBe("ENOENT");
    expect(await code(rootTrash(base, "out/secret.3mf", ".trash", "x"))).toBe("ENOENT");
    await writeFile(join(base, "a.3mf"), "x");
    expect(await code(rootTrash(base, "a.3mf", ".trash", "../x"))).toBe("EINVAL");
    // A trash folder that leads out of the root.
    expect(await code(rootTrash(base, "a.3mf", "out", "x"))).toBe("EACCES");
    expect(await readdir(outside)).toEqual(["secret.3mf"]);
  });
});

describe("shared folders", () => {
  it("finds the folder holding a path, never a sibling with the same prefix", () => {
    expect(within([base], base)).toBe(base);
    expect(within([base], join(base, "001_Box"))).toBe(base);
    expect(within([base], `${base}X`)).toBeUndefined();
    expect(within([base], dir)).toBeUndefined();
    // Windows paths compare case-insensitively, others don't.
    expect(within([base], base.toUpperCase())).toBe(
      process.platform === "win32" ? base : undefined,
    );
  });

  it("lists only inside the folders, also through `..` and links", async () => {
    expect((await listShared(null, [base])).entries).toEqual([
      { name: base, path: base, type: "dir" },
    ]);
    const top = await listShared(base, [base]);
    expect(top.parent).toBeNull();
    expect(top.entries.map((e) => e.name)).toEqual(["001_Box", "out"]);
    expect((await listShared(join(base, "001_Box"), [base])).parent).toBe(base);
    for (const p of [dir, outside, join(base, ".."), join(base, "out"), join(dir, "nope"), "/"])
      expect(await code(listShared(p, [base])), p).toBe("EACCES");
    expect(await code(listShared("relative", [base]))).toBe("EINVAL");
    expect(await code(listShared(base, []))).toBe("EACCES");
  });
});
