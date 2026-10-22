import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let dir: string;
let db: ReturnType<typeof openDb>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "updates-"));
  db = openDb(":memory:");
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const releases = async () => [
  { tag: "v1.0.0", prerelease: false, url: "u1" },
  { tag: "v1.1.0-alpha.1", prerelease: true, url: "u2" },
];
const updateAlerts = () =>
  db.select().from(schema.alerts).where(eq(schema.alerts.kind, "update_available")).all();

describe("update check", () => {
  it("offers the newest release on the channel and raises one alert for it", async () => {
    const app = await buildApp(db, false, "", {
      updater: { version: "1.0.0-alpha.9", install: "other", releases },
    });
    const view = (await app.inject("/api/updates")).json();
    expect(view).toMatchObject({ version: "1.0.0-alpha.9", install: "other", latest: null });

    const checked = (await app.inject({ method: "POST", url: "/api/updates/check" })).json();
    expect(checked.latest).toEqual({ tag: "v1.0.0", url: "u1" });
    await app.inject({ method: "POST", url: "/api/updates/check" });
    expect(updateAlerts()).toMatchObject([{ entityId: "v1.0.0", module: "system" }]);

    // dev sees the pre-release; the next check resolves the stable one's alert.
    await app.inject({
      method: "PATCH",
      url: "/api/preferences",
      payload: { updateChannel: "dev" },
    });
    expect((await app.inject("/api/updates")).json().latest.tag).toBe("v1.1.0-alpha.1");
    await app.inject({ method: "POST", url: "/api/updates/check" });
    const open = updateAlerts().filter((a) => !a.resolvedAt);
    expect(open.map((a) => a.entityId)).toEqual(["v1.1.0-alpha.1"]);
  });

  it("refuses to update an install that isn't git", async () => {
    const app = await buildApp(db, false, "", { updater: { install: "docker", releases } });
    const res = await app.inject({
      method: "POST",
      url: "/api/updates/apply",
      payload: { tag: "v9.0.0" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("not_git");
  });
});

describe("update and rollback on a git install", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  it("backs up, fetches and hands over to the launcher; then rolls back with that backup", async () => {
    const origin = join(dir, "origin");
    mkdirSync(origin);
    git(origin, "init", "-q");
    git(origin, "config", "user.email", "t@t");
    git(origin, "config", "user.name", "t");
    writeFileSync(join(origin, ".gitignore"), ".update/\n");
    for (const v of ["1.0.0", "1.1.0"]) {
      writeFileSync(join(origin, "package.json"), JSON.stringify({ version: v }));
      git(origin, "add", ".");
      git(origin, "commit", "-qm", v);
      git(origin, "tag", `v${v}`);
    }
    const root = join(dir, "app");
    git(dir, "clone", "-q", "--no-tags", origin, root);
    git(root, "checkout", "-q", "--detach", "HEAD~1");
    const from = git(root, "rev-parse", "HEAD");
    const dataDir = join(dir, "data");
    mkdirSync(dataDir);
    const fileDb = openDb(join(dataDir, "app.sqlite"));
    const opts = { root, install: "git" as const, releases };
    let app = await buildApp(fileDb, false, dataDir, { updater: { ...opts, version: "1.0.0" } });
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });

    expect((await post("/api/updates/apply", { tag: "v1.0.0" })).json().error.code).toBe(
      "not_newer",
    );
    expect((await post("/api/updates/apply", { tag: "main" })).json().error.code).toBe("bad_tag");
    writeFileSync(join(root, "package.json"), "{}");
    expect((await post("/api/updates/apply", { tag: "v1.1.0" })).json().error.code).toBe("dirty");
    git(root, "checkout", "--", "package.json");

    expect((await post("/api/updates/apply", { tag: "v1.1.0" })).statusCode).toBe(202);
    const pending = JSON.parse(readFileSync(join(root, ".update", "pending.json"), "utf8"));
    expect(pending).toMatchObject({ action: "update", ref: "v1.1.0", from, fromVersion: "1.0.0" });
    expect(existsSync(join(dataDir, "backups", pending.backup))).toBe(true);
    expect(git(root, "tag", "-l", "v1.1.0")).toBe("v1.1.0");
    await app.close();

    // The launcher did its part; the new version starts and records it.
    rmSync(join(root, ".update", "pending.json"));
    writeFileSync(join(root, ".update", "result.json"), JSON.stringify({ ...pending, ok: true }));
    app = await buildApp(fileDb, false, dataDir, { updater: { ...opts, version: "1.1.0" } });
    const [entry] = (await app.inject("/api/updates")).json().history;
    expect(entry).toMatchObject({
      action: "update",
      fromSha: from,
      toVersion: "1.1.0",
      canRollBack: true,
    });
    expect(existsSync(join(root, ".update", "result.json"))).toBe(false);

    expect((await post("/api/updates/rollback", { backup: entry.backup })).statusCode).toBe(202);
    expect(JSON.parse(readFileSync(join(root, ".update", "pending.json"), "utf8"))).toMatchObject({
      action: "rollback",
      ref: from,
      toVersion: "1.0.0",
      restoreDir: join(dataDir, "restore-pending"),
    });
    expect(existsSync(join(dataDir, "restore-pending", "app.sqlite"))).toBe(true);
    await app.close();
    fileDb.$client.close();
  });
});
