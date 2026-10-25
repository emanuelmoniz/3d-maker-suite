import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";
import { openDb } from "@3d-maker-suite/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const list = (query: Record<string, string>) =>
  app.inject({ url: `/api/fs/list?${new URLSearchParams(query)}` });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fs-list-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "a.EXE"), "");
  writeFileSync(join(dir, "b.txt"), "TOP-SECRET-CONTENT");
  app = await buildApp(openDb(":memory:"), false, "");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("GET /api/fs/list", () => {
  it("lists drives (Windows) or / and home with no path", async () => {
    const body = (await list({})).json();
    expect(body.path).toBeNull();
    const paths = body.entries.map((e: { path: string }) => e.path);
    if (process.platform === "win32")
      expect(paths.every((p: string) => /^[A-Z]:\\$/.test(p))).toBe(true);
    else expect(paths).toEqual(["/", homedir()]);
    expect(paths.length).toBeGreaterThan(0);
  });

  it("folder mode lists only folders", async () => {
    const body = (await list({ path: dir })).json();
    expect(body.entries.map((e: { name: string }) => e.name)).toEqual(["sub"]);
    expect(body.parent).not.toBeNull();
  });

  it("file mode filters by extension, case-insensitively, folders first", async () => {
    const names = (r: { json(): { entries: { name: string }[] } }) =>
      r.json().entries.map((e) => e.name);
    expect(names(await list({ path: dir, mode: "file", ext: ".exe" }))).toEqual(["sub", "a.EXE"]);
    expect(names(await list({ path: dir, mode: "file" }))).toEqual(["sub", "a.EXE", "b.txt"]);
  });

  it("never returns file contents", async () => {
    const res = await list({ path: dir, mode: "file" });
    expect(res.body).not.toContain("TOP-SECRET-CONTENT");
    expect(Object.keys(res.json().entries[0]).sort()).toEqual(["name", "path", "type"]);
  });

  it("rejects missing, non-folder and relative paths", async () => {
    const missing = await list({ path: join(dir, "nope") });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("path_not_found");
    const file = await list({ path: join(dir, "b.txt") });
    expect(file.statusCode).toBe(400);
    expect(file.json().error.code).toBe("not_a_directory");
    expect((await list({ path: "relative/dir" })).statusCode).toBe(400);
  });

  it("has no parent at a filesystem root", async () => {
    expect((await list({ path: parse(dir).root })).json().parent).toBeNull();
  });

  it("is behind the access guard", async () => {
    const guarded = await buildApp(openDb(":memory:"), false, "", {
      access: { host: "127.0.0.1" },
    });
    const res = await guarded.inject({ url: "/api/fs/list", headers: { host: "evil.example" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/fs/folder", () => {
  it("makes one folder inside an existing one; names stay single segments", async () => {
    const make = (name: string, path = dir) =>
      app.inject({ method: "POST", url: "/api/fs/folder", payload: { path, name } });
    const ok = await make("new one");
    expect(ok.statusCode).toBe(201);
    expect(ok.json().path).toBe(join(dir, "new one"));
    expect((await make("new one")).json().error.code).toBe("path_exists");
    for (const bad of ["..", "a/b", "a\b", "x:y", " ", "end."])
      expect((await make(bad)).statusCode, bad).toBe(400);
    expect((await make("x", join(dir, "missing"))).statusCode).toBe(404);
  });
});
