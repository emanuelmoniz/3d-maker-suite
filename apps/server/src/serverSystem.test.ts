import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, schema } from "@3d-maker-suite/db";
import { describe, expect, it, onTestFinished } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

describe("this server's system info", () => {
  const setup = async (env: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "server-system-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const models = join(dir, "models");
    mkdirSync(models);
    const db = openDb(":memory:");
    db.insert(schema.roots)
      .values([
        { name: "Models", location: "hub", path: models, position: 0 },
        // Not the server's: a device's folder isn't on this disk.
        { name: "Desk", location: crypto.randomUUID(), path: "/elsewhere", position: 1 },
      ])
      .run();
    const app = await buildApp(db, false, dir, {
      serverConfig: loadConfig({ APP_DATA_DIR: dir, ...env }, []),
    });
    return { dir, models, get: () => app.inject("/api/server/system") };
  };

  it("reads CPU, memory, the data dir's and project folders' disk, and addresses", async () => {
    const { dir, models, get } = await setup();
    const res = await get();
    expect(res.statusCode).toBe(200);
    const info = res.json();
    expect(info.cores).toBeGreaterThan(0);
    expect(info.memory.total).toBeGreaterThan(info.memory.used);
    // One drive: the data dir and the project folder inside it.
    expect(info.disks).toHaveLength(1);
    expect(info.disks[0].paths).toEqual([dir, models]);
    expect(info.disks[0].total).toBeGreaterThan(0);
    expect(info.docker).toBe(false);
  });

  it("gives no addresses in Docker: the container's aren't the host's", async () => {
    const { get } = await setup({ APP_INSTALL: "docker" });
    expect((await get()).json()).toMatchObject({ addresses: [], docker: true });
  });
});
