import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applyPending } from "./update.mjs";

let root;
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const commit = (tag, node = 22) => {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ tag, engines: { node: `>=${node}` } }),
  );
  git("add", ".");
  git("commit", "-qm", tag);
  git("tag", tag);
};
const checkedOut = () => JSON.parse(readFileSync(join(root, "package.json"), "utf8")).tag;
const pending = (p) => {
  mkdirSync(join(root, ".update"), { recursive: true });
  writeFileSync(join(root, ".update", "pending.json"), JSON.stringify(p));
};
/** Real git; pnpm fails on the given step while `bad` is checked out. */
const runner = (bad, failing) => (cmd, args) => {
  if (cmd === "git") return git(...args);
  const step = args[0] === "install" ? "install" : "build";
  if (checkedOut() === bad && step === failing) throw new Error("boom");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "3dms-update-"));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), ".update/\n");
  commit("v1.0.0");
  commit("v1.1.0");
  commit("v1.2.0", 99);
  git("checkout", "-q", "--detach", "v1.0.0");
});

describe("applyPending", () => {
  it("does nothing without a pending file", () => {
    expect(applyPending(root, runner())).toBeNull();
  });

  it("checks out, installs and builds the new version", () => {
    pending({
      action: "update",
      ref: "v1.1.0",
      from: git("rev-parse", "HEAD"),
      toVersion: "1.1.0",
    });
    expect(applyPending(root, runner())).toMatchObject({ ok: true, ref: "v1.1.0" });
    expect(checkedOut()).toBe("v1.1.0");
    expect(existsSync(join(root, ".update", "pending.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, ".update", "result.json"), "utf8")).ok).toBe(true);
  });

  it("goes back when the build fails, dropping a staged restore", () => {
    const restoreDir = join(root, "restore-pending");
    mkdirSync(restoreDir);
    pending({ action: "rollback", ref: "v1.1.0", from: git("rev-parse", "HEAD"), restoreDir });
    expect(applyPending(root, runner("v1.1.0", "build"))).toMatchObject({
      ok: false,
      failedStep: "build",
    });
    expect(checkedOut()).toBe("v1.0.0");
    expect(existsSync(restoreDir)).toBe(false);
  });

  it("refuses a release that needs a newer Node before installing", () => {
    pending({ action: "update", ref: "v1.2.0", from: git("rev-parse", "HEAD") });
    expect(applyPending(root, runner(), 22)).toMatchObject({
      ok: false,
      failedStep: "node",
      needsNode: 99,
    });
    expect(checkedOut()).toBe("v1.0.0");
  });

  it("throws when going back fails too", () => {
    pending({ action: "update", ref: "v1.1.0", from: git("rev-parse", "HEAD") });
    const run = runner("v1.1.0", "install");
    expect(() =>
      applyPending(root, (cmd, args) => {
        if (cmd === "pnpm" && checkedOut() === "v1.0.0") throw new Error("still broken");
        return run(cmd, args);
      }),
    ).toThrow(/Could not go back/);
  });
});
