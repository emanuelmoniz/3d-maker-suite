import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  beginPending,
  compareVersions,
  newest,
  relink,
  rotate,
  serverUrl,
  settle,
} from "./launcher.mjs";

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
    const dir = install(
      "4.1.0-alpha.9",
      "4.1.0-alpha.10",
      "4.1.1.partial",
      "4.1.0-alpha.11.partial",
      "4.1.0-alpha.12.old",
      "4.0.2",
    );
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

describe("pending update or rollback", () => {
  /** An install with these versions, a data dir with an undo, and the server's pending.json. */
  const handOver = (versions, pending) => {
    const dir = install(...versions);
    const data = join(dir, "data");
    mkdirSync(join(data, "update-undo"), { recursive: true });
    writeFileSync(join(data, "update-undo", "manifest.json"), "{}");
    const p = {
      ...pending,
      backup: "update-1.zip",
      undo: join(data, "update-undo"),
      restoreDir: join(data, "restore-pending"),
    };
    mkdirSync(join(dir, ".update"));
    writeFileSync(join(dir, ".update", "pending.json"), JSON.stringify(p));
    const result = () => JSON.parse(readFileSync(join(dir, ".update", "result.json"), "utf8"));
    return { dir, data, result };
  };
  const update = { action: "update", fromVersion: "4.1.1", toVersion: "4.1.2" };
  const rollback = { action: "rollback", fromVersion: "4.1.0-alpha.2", toVersion: "4.1.0-alpha.1" };

  it("finds nothing without pending.json", () => {
    expect(beginPending(install("4.1.0"))).toBeNull();
  });

  it("a good update drops the undo and leftovers and keeps two versions", () => {
    const { dir, data, result } = handOver(["4.1.0", "4.1.1", "4.1.2", "4.1.3.partial"], update);
    const p = beginPending(dir);
    expect(newest(dir)?.version).toBe(p.toVersion);
    settle(dir, p, true);
    expect(readdirSync(join(dir, "versions")).sort()).toEqual(["4.1.1", "4.1.2"]);
    expect(existsSync(join(data, "update-undo"))).toBe(false);
    expect(existsSync(join(dir, ".update", "pending.json"))).toBe(false);
    expect(result()).toMatchObject({ ok: true, toVersion: "4.1.2" });
    expect(beginPending(dir)).toBeNull();
  });

  it("a failed update deletes the new version and stages the undo", () => {
    const { dir, data, result } = handOver(["4.1.1", "4.1.2"], update);
    settle(dir, beginPending(dir), false);
    expect(newest(dir)?.version).toBe("4.1.1");
    expect(existsSync(join(data, "restore-pending", "manifest.json"))).toBe(true);
    expect(existsSync(join(data, "update-undo"))).toBe(false);
    expect(result()).toMatchObject({ ok: false, failedStep: "start" });
  });

  it("a rollback hides the running version; failing puts it back", () => {
    const { dir, data } = handOver(["4.1.0-alpha.1", "4.1.0-alpha.2"], rollback);
    mkdirSync(join(data, "restore-pending"));
    const p = beginPending(dir);
    expect(newest(dir)?.version).toBe("4.1.0-alpha.1");
    expect(beginPending(dir)).toEqual(p); // after a crash: same again
    settle(dir, p, false);
    expect(newest(dir)?.version).toBe("4.1.0-alpha.2");
    expect(existsSync(join(data, "restore-pending", "manifest.json"))).toBe(true); // the undo
  });

  it("a good rollback deletes the newer version", () => {
    const { dir } = handOver(["4.1.0-alpha.1", "4.1.0-alpha.2"], rollback);
    settle(dir, beginPending(dir), true);
    expect(readdirSync(join(dir, "versions"))).toEqual(["4.1.0-alpha.1"]);
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
