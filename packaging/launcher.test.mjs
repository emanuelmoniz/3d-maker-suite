import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareVersions, newest, relink, rotate, serverUrl } from "./launcher.mjs";

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

describe("serverUrl", () => {
  it("follows flag > env > saved config > default", () => {
    const dir = install();
    expect(serverUrl(dir, {}, [])).toBe("http://127.0.0.1:4300/");
    writeFileSync(join(dir, "config.json"), '{"host":"0.0.0.0","port":5000}');
    expect(serverUrl(dir, {}, [])).toBe("http://127.0.0.1:5000/"); // wildcard -> loopback
    expect(serverUrl(dir, { PORT: "5100" }, [])).toBe("http://127.0.0.1:5100/");
    expect(serverUrl(dir, { PORT: "5100" }, ["--port", "5200", "--host", "::1"])).toBe(
      "http://[::1]:5200/",
    );
  });
});

describe("rotate", () => {
  it("moves a log over the limit to .1 and leaves a small one", () => {
    const file = join(install(), "server.log");
    writeFileSync(file, "x".repeat(10));
    rotate(file, 100);
    expect(existsSync(file)).toBe(true);
    rotate(file, 5);
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.1`, "utf8")).toHaveLength(10);
  });
});
