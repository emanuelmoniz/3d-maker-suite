import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT_RESCAN_DEFAULT, type RootRescan } from "@3d-maker-suite/core";
import { type Db, openDb, schema } from "@3d-maker-suite/db";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubChannel } from "../lib/hubChannel.ts";
import { createRescans } from "./rescans.ts";
import { createProjectScanner } from "./scanner.ts";

const scanned: string[] = [];
vi.mock("@3d-maker-suite/host", async (orig) => {
  const mod = await orig<typeof import("@3d-maker-suite/host")>();
  return {
    ...mod,
    scanFolder: (folder: string, ...rest: [(string | null)?, number?, (number | null)?]) => {
      scanned.push(folder);
      return mod.scanFolder(folder, ...rest);
    },
  };
});

const log = { warn() {}, error() {}, info() {} } as unknown as FastifyBaseLogger;
let dir: string;
let db: Db;
const put = async (path: string, content = "solid") => {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), content);
};
const addRoot = (path: string, rescan: Partial<RootRescan> = {}, location = "hub") =>
  db
    .insert(schema.roots)
    .values({
      name: path,
      path,
      location,
      position: 0,
      rescan: { ...ROOT_RESCAN_DEFAULT, ...rescan },
    })
    .returning()
    .get();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rescans-"));
  db = openDb(":memory:");
  scanned.length = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("a hub root's rescan", () => {
  it("reads again only folders that changed, finds new ones and stays in its root", async () => {
    await put("models/A/a.stl");
    await put("models/B/b.stl");
    await put("other/D/d.stl");
    const models = addRoot(join(dir, "models"));
    addRoot(join(dir, "other"));
    const scanner = createProjectScanner(db, join(dir, "data"), log);
    scanner.start();
    while (scanner.status().state === "running") await new Promise((r) => setTimeout(r, 10));
    scanned.length = 0;

    await scanner.rescan(models); // first sight: records the digests, reads nothing
    expect(scanned).toEqual([]);
    await scanner.rescan(models);
    expect(scanned).toEqual([]);

    // Changed with no watcher (none runs here): only A is read again.
    await put("models/A/a.stl", "solid, a bigger one");
    await put("models/C/c.stl");
    await scanner.rescan(models);
    expect(scanned.sort()).toEqual([join(dir, "models", "A"), join(dir, "models", "C")]);
    const names = db
      .select({ name: schema.projects.name })
      .from(schema.projects)
      .all()
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(["A", "B", "C", "D"]);
  });
});

describe("rescan schedule", () => {
  const hour = 3600 * 1000;
  const start = Date.parse("2026-11-13T10:00:00Z");

  it("runs each enabled root when due: a hub root here, a device root on its connector", async () => {
    const hubOn = addRoot(join(dir, "a"));
    addRoot(join(dir, "b"), { enabled: false });
    const device = crypto.randomUUID();
    const onDevice = addRoot("D:\\Shared", {}, device);
    const rescan = vi.fn(async (_root: { id: string }) => {});
    let online = true;
    const tell = vi.fn(() => online);
    const tick = createRescans(db, { rescan }, { tell } as unknown as HubChannel);

    await tick(start);
    expect(rescan.mock.calls.map(([r]) => r.id)).toEqual([hubOn.id]);
    expect(tell).toHaveBeenCalledWith(device, { type: "roots.rescan", rootId: onDevice.id });

    await tick(start + 10 * 60 * 1000); // within the hour: nothing
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(tell).toHaveBeenCalledTimes(1);

    // An offline device is tried again on the next tick, not after another hour.
    online = false;
    await tick(start + hour);
    expect(rescan).toHaveBeenCalledTimes(2);
    online = true;
    await tick(start + hour + 60 * 1000);
    expect(tell).toHaveBeenCalledTimes(3);
  });
});
