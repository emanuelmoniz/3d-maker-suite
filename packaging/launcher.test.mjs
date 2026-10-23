import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareVersions, newest, relink } from "./launcher.mjs";

const install = (...versions) => {
  const dir = mkdtempSync(join(tmpdir(), "launcher-"));
  for (const v of versions) mkdirSync(join(dir, "versions", v), { recursive: true });
  return dir;
};

describe("newest", () => {
  it("orders like core's compareVersions", () => {
    expect(compareVersions("4.1.0-alpha.10", "4.1.0-alpha.9")).toBe(1);
    expect(compareVersions("4.1.0", "4.1.0-alpha.10")).toBe(1);
    expect(compareVersions("4.0.9", "4.1.0-alpha.1")).toBe(-1);
  });

  it("picks the highest finished folder", () => {
    const dir = install("4.1.0-alpha.9", "4.1.0-alpha.10", "4.1.1.partial", "4.0.2");
    expect(newest(dir)?.version).toBe("4.1.0-alpha.10");
  });

  it("counts the version shipped inside the .app", () => {
    const dir = install("4.1.0");
    expect(newest(dir, { version: "4.1.1", app: "/app" })).toEqual({
      version: "4.1.1",
      app: "/app",
    });
    expect(newest(dir, { version: "4.0.0", app: "/app" })?.version).toBe("4.1.0");
  });

  it("finds nothing without versions/", () => {
    expect(newest(install())).toBeUndefined();
  });
});

describe("relink", () => {
  it("recreates the recorded links and keeps existing ones", () => {
    const app = install();
    mkdirSync(join(app, "packages", "core"), { recursive: true });
    writeFileSync(join(app, "packages", "core", "package.json"), '{"name":"core"}');
    writeFileSync(
      join(app, "links.json"),
      JSON.stringify([["node_modules/@3d-maker-suite/core", "../../packages/core"]]),
    );
    relink(app);
    relink(app); // a second start finds the link and leaves it
    const at = join(app, "node_modules", "@3d-maker-suite", "core");
    expect(lstatSync(at).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(at, "package.json"), "utf8")).toBe('{"name":"core"}');
  });
});
