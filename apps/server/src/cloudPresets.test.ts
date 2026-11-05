import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bambuStudioAdapter, bambuStudioServerAdapter } from "@3d-maker-suite/adapter-bambu";
import {
  type ImportPreview,
  type IntegrationAdapter,
  IntegrationError,
  type SyncResult,
  USER_PRESET_TYPES,
  type UserPresetEntry,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { loadKey } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { savePreset, uploadPreset } from "./integrations/presetLibrary.ts";
import { createSyncer } from "./integrations/sync.ts";

// Bambu Cloud's user presets (ADR-0019), from a fake account: the adapter's own requests are tested
// with recorded payloads in its package.
type Account = {
  list: UserPresetEntry[];
  presets: Record<string, Record<string, unknown>>;
  lists: number;
  gets: string[];
  fail?: "list" | "get";
};
let account: Account;
const cloudAdapter: IntegrationAdapter = {
  id: "cloud-test",
  kind: "cloud",
  capabilities: USER_PRESET_TYPES,
  configSchema: z.object({}),
  secretsSchema: z.object({}),
  create: () => ({
    test: async () => ({ ok: true }),
    userPresets: {
      library: "bambu-studio",
      list: async () => {
        account.lists++;
        if (account.fail === "list") throw new IntegrationError("api_changed");
        return account.list.map((e) => ({ ...e }));
      },
      get: async (id) => {
        account.gets.push(id);
        if (account.fail === "get") throw new IntegrationError("unreachable");
        return structuredClone(account.presets[id] ?? {});
      },
    },
  }),
};
const ADAPTERS = [cloudAdapter, bambuStudioAdapter(), bambuStudioServerAdapter()];

/** A preset as the account keeps it: only what differs from its parent. */
const put = (id: string, name: string, updatedAt: string, extra: object = {}) => {
  account.list = [
    ...account.list.filter((e) => e.id !== id),
    { id, kind: "filament", name, updatedAt },
  ];
  account.presets[id] = {
    name,
    inherits: "Generic PLA",
    filament_cost: ["30"],
    from: "User",
    ...extra,
  };
};
const drop = (...ids: string[]) => {
  account.list = account.list.filter((e) => !ids.includes(e.id));
};

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dataDir: string;
const { filamentProfiles, importSnapshots, slicerPresets, syncPolicies, syncRuns } = schema;

beforeEach(async () => {
  account = { list: [], presets: {}, lists: 0, gets: [] };
  db = openDb(":memory:");
  dataDir = mkdtempSync(join(tmpdir(), "cloud-presets-"));
  app = await buildApp(db, false, dataDir, { adapters: ADAPTERS });
  await app.ready();
  setting("hubEnabled", true);
});

const setting = (key: string, value: unknown) =>
  db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
const add = async (adapterId: string) =>
  (await app.inject({ method: "POST", url: "/api/integrations", payload: { adapterId } })).json()
    .id as string;
const TYPE = "userFilamentProfiles";
const auto = (id: string) =>
  app.inject({
    method: "PATCH",
    url: `/api/integrations/${id}`,
    payload: { policies: [{ type: TYPE, mode: "auto" }] },
  });
const addCloud = async () => {
  const id = await add("cloud-test");
  await auto(id);
  return id;
};
const sync = async (id: string) =>
  (
    await app.inject({
      method: "POST",
      url: `/api/integrations/${id}/sync`,
      payload: { type: TYPE },
    })
  ).json() as SyncResult;
const review = async (id: string) =>
  (
    await app.inject({ method: "POST", url: `/api/import/integration/${id}/${TYPE}` })
  ).json() as ImportPreview;
const pendingOf = (id: string) =>
  db
    .select()
    .from(syncPolicies)
    .all()
    .find((p) => p.integrationId === id && p.type === TYPE)?.pending ?? 0;
const profiles = () => db.select().from(filamentProfiles).all();
const library = () =>
  Object.fromEntries(
    db
      .select()
      .from(slicerPresets)
      .all()
      .map((p) => [p.name, p.deleted ? "deleted" : p.version]),
  );
const importedBy = (name: string) => {
  const row = profiles().find((p) => p.name === name);
  return db
    .select()
    .from(importSnapshots)
    .all()
    .filter((s) => s.rowId === row?.id)
    .map((s) => s.integrationId);
};

/** A desktop Bambu Studio with the system preset the account's presets inherit from. */
const studio = () => join(dataDir, "studio");
const desktopStudio = async (user: Record<string, object> = {}) => {
  const dir = studio();
  const parent = join(dir, "system", "BBL", "filament");
  mkdirSync(parent, { recursive: true });
  writeFileSync(
    join(parent, "Generic PLA.json"),
    JSON.stringify({ name: "Generic PLA", filament_type: ["PLA"], filament_vendor: ["Generic"] }),
  );
  const mine = join(dir, "user", "123", "filament");
  for (const [name, json] of Object.entries(user)) {
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, `${name}.json`), JSON.stringify({ name, ...json }));
  }
  const id = await add("bambu-studio");
  db.update(schema.integrations)
    .set({ slicerConfigDir: dir })
    .where(eq(schema.integrations.id, id))
    .run();
  return id;
};
const syncer = () => createSyncer(db, ADAPTERS, loadKey(dataDir), app.log, dataDir);

it("starts in Manual, daily: nothing is read until someone asks", async () => {
  const id = await add("cloud-test");
  const cards = db
    .select()
    .from(syncPolicies)
    .all()
    .filter((p) => p.integrationId === id);
  expect(cards.map((p) => [p.type, p.mode, p.frequency])).toEqual(
    USER_PRESET_TYPES.map((t) => [t, "manual", "1d"]),
  );
  await syncer().runAll();
  expect(account.lists).toBe(0);
});

it("reaches the catalog as Studio's preset, fetching only what changed, and versions real edits only", async () => {
  await desktopStudio();
  const id = await addCloud();
  put("P1", "Mine", "t1");
  expect((await sync(id)).errorCode).toBeNull();

  // Its parent gives the material, so it needs no review.
  expect(profiles()).toMatchObject([{ name: "Mine", sourcePreset: "bambu-studio:user/Mine" }]);
  expect(pendingOf(id)).toBe(0);
  expect(library()).toEqual({ Mine: 1 });
  expect(account.gets).toEqual(["P1"]);

  await sync(id);
  expect(account.gets).toEqual(["P1"]);

  // A re-upload with a value equal to the parent's: the same settings, no new version.
  put("P1", "Mine", "t2", { filament_type: ["PLA"] });
  await sync(id);
  expect(account.gets).toEqual(["P1", "P1"]);
  expect(library()).toEqual({ Mine: 1 });

  put("P1", "Mine", "t3", { filament_cost: ["45"] });
  await sync(id);
  expect(library()).toEqual({ Mine: 2 });
});

it("with no system presets to read, a preset waits for review", async () => {
  const id = await addCloud();
  put("P1", "Mine", "t1");
  await sync(id);
  expect(profiles()).toEqual([]);
  expect(pendingOf(id)).toBe(1);
});

it("a failed or changed list, or a failed get, writes and deletes nothing", async () => {
  await desktopStudio();
  const id = await addCloud();
  put("P1", "Mine", "t1");
  await sync(id);

  drop("P1");
  account.fail = "list";
  expect((await sync(id)).errorCode).toBe("api_changed");
  account.fail = "get";
  put("P2", "Other", "t1");
  expect((await sync(id)).errorCode).toBe("unreachable");

  expect(library()).toEqual({ Mine: 1 });
  expect(profiles().map((p) => p.name)).toEqual(["Mine"]);
  expect(pendingOf(id)).toBe(0);
});

describe("a preset gone from the account", () => {
  it("goes from the library if nothing uses it; one in use waits; the catalog row asks", async () => {
    await desktopStudio();
    const id = await addCloud();
    put("P1", "Mine", "t1");
    put("P2", "Other", "t1");
    put("P3", "Third", "t1");
    await sync(id);
    savePreset(db, dataDir, {
      library: "bambu-studio",
      kind: "filament",
      name: "Child",
      json: JSON.stringify({ name: "Child", inherits: "Other" }),
    });

    drop("P1", "P2");
    await sync(id);
    expect(library()).toMatchObject({ Mine: "deleted", Other: 1, Third: 1 });
    // Never deleted by a run: each catalog row waits for a person.
    expect(
      profiles()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Mine", "Other", "Third"]);
    expect((await review(id)).gone?.map((g) => g.label).sort()).toEqual([
      expect.stringContaining("Mine"),
      expect.stringContaining("Other"),
    ]);

    db.delete(slicerPresets).where(eq(slicerPresets.name, "Child")).run();
    await sync(id);
    expect(library()).toMatchObject({ Other: "deleted", Third: 1 });
  });

  it("is held when too many go at once, or all of them, until a person's Delete", async () => {
    setting("hubDeleteGuard", 1);
    await desktopStudio();
    const id = await addCloud();
    put("P1", "Mine", "t1");
    put("P2", "Other", "t1");
    put("P3", "Third", "t1");
    await sync(id);

    drop("P1", "P2");
    await sync(id);
    expect(library()).toEqual({ Mine: 1, Other: 1, Third: 1 });
    const [run] = db.select().from(syncRuns).orderBy(syncRuns.startedAt).all().slice(-1);
    expect(run?.log).toContainEqual({ event: "held", count: 2 });

    // Still held at the next run; Delete in the review takes the row and its copy.
    await sync(id);
    expect(library()).toEqual({ Mine: 1, Other: 1, Third: 1 });
    const mine = (await review(id)).gone?.find((g) => g.label.includes("Mine"));
    const del = await app.inject({
      method: "DELETE",
      url: `/api/import/integration/${id}/${TYPE}/gone/${mine?.id}`,
    });
    expect(del.statusCode, del.body).toBe(200);
    expect(library()).toMatchObject({ Mine: "deleted", Other: 1 });
    expect(profiles().map((p) => p.name)).not.toContain("Mine");

    // All of an account's presets gone at once looks like another account.
    setting("hubDeleteGuard", 20);
    put("P4", "Fourth", "t1");
    await sync(id);
    drop("P3", "P4");
    put("P5", "Fifth", "t1");
    await sync(id);
    expect(library()).toMatchObject({ Third: 1, Fourth: 1, Fifth: 1 });
  });

  it("leaves a zip's preset alone: the account never had it", async () => {
    await desktopStudio();
    const server = await add("bambu-studio-server");
    const id = await addCloud();
    savePreset(db, dataDir, {
      library: "bambu-studio",
      kind: "filament",
      name: "Zipped",
      json: JSON.stringify({ name: "Zipped", filament_type: ["PETG"] }),
    });
    await syncer().checkUserPresets();
    expect(importedBy("Zipped")).toEqual([server]);

    put("P1", "Mine", "t1");
    put("P2", "Kept", "t1");
    await sync(id);
    drop("P1");
    await sync(id);
    expect(library()).toMatchObject({ Zipped: 1, Mine: "deleted", Kept: 1 });
    expect((await review(id)).gone?.map((g) => g.label)).toEqual([expect.stringContaining("Mine")]);
  });
});

describe("one preset, one route", () => {
  it("a cloud preset written to the library is the cloud card's only, Share on too", async () => {
    await desktopStudio();
    const server = await add("bambu-studio-server");
    const id = await addCloud();
    // The same preset shared by a connector of that account first.
    uploadPreset(
      db,
      dataDir,
      {
        library: "bambu-studio",
        kind: "filament",
        name: "Mine",
        base: 0,
        // As a desktop Studio saves it, with a value equal to its parent's the cloud copy drops.
        text: JSON.stringify({
          name: "Mine",
          inherits: "Generic PLA",
          filament_cost: ["30"],
          filament_type: ["PLA"],
        }),
      },
      "device-1",
      { device: "WS-3" },
    );
    const s = syncer();
    await s.checkUserPresets();
    expect(importedBy("Mine")).toEqual([server]);

    put("P1", "Mine", "t1");
    put("P2", "Other", "t1");
    await sync(id);
    await s.checkUserPresets();
    await s.checkUserPresets();

    expect(
      profiles()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Mine", "Other"]);
    expect(importedBy("Other")).toEqual([id]);
    const rows = (await review(server)).rows.map((r) => r.values.name);
    expect(rows).not.toContain("Mine");
    expect(rows).not.toContain("Other");
    expect(pendingOf(server)).toBe(0);
    // The same settings as the shared copy: no new version.
    expect(library()).toEqual({ Mine: 1, Other: 1 });

    // Gone from the account: the server row doesn't report it, the cloud's does.
    drop("P2");
    await sync(id);
    await s.checkUserPresets();
    expect((await review(server)).gone ?? []).toEqual([]);
    expect((await review(id)).gone?.map((g) => g.label)).toEqual([
      expect.stringContaining("Other"),
    ]);
  });

  it("a single PC: a desktop folder's preset moves to the cloud's card, which writes nothing there", async () => {
    setting("hubEnabled", false);
    const desk = await desktopStudio({ Mine: { inherits: "Generic PLA", filament_cost: ["30"] } });
    const id = await addCloud();
    const s = syncer();
    await s.checkUserPresets();
    expect(importedBy("Mine")).toEqual([desk]);

    put("P1", "Mine", "t1");
    await sync(id);
    expect((await review(desk)).rows.map((r) => r.values.name)).not.toContain("Mine");
    expect((await review(id)).rows.map((r) => r.values.name)).toEqual(["Mine"]);
    expect(pendingOf(desk)).toBe(0);
    expect(existsSync(join(studio(), "user", "cloud"))).toBe(false);
    expect(library()).toEqual({});

    // Gone from the account: the desktop folder still has it, and reports nothing.
    drop("P1");
    await sync(id);
    expect((await review(desk)).gone ?? []).toEqual([]);
  });

  it("a single PC's server slicer gets the copies, written again after a zip took them away", async () => {
    setting("hubEnabled", false);
    await desktopStudio();
    const server = await add("bambu-studio-server");
    const id = await addCloud();
    put("P1", "Mine", "t1");
    await sync(id);
    const config = join(dataDir, "slicers", server, "config");
    const copy = join(config, "user", "cloud", "filament", "Mine.json");
    expect(JSON.parse(readFileSync(copy, "utf8"))).toMatchObject({ name: "Mine", from: "User" });

    rmSync(join(config, "user"), { recursive: true });
    await sync(id);
    expect(existsSync(copy)).toBe(true);

    drop("P1");
    await sync(id);
    expect(existsSync(copy)).toBe(false);
  });
});
