// A real hub (the server's buildApp on a free port) and connectors whose slicer is a temp folder.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BUILT_IN_ROLE_IDS, type SlicerPreset } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { adapters } from "@3d-maker-suite/server/src/integrations/registry.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLink } from "./hub.ts";
import { configDirOf, createPresetShare, presetFolder } from "./presets.ts";
import type { Found } from "./slicers.ts";
import { openStore } from "./state.ts";

const until = async (ok: () => boolean | Promise<boolean>, ms = 20_000) => {
  for (const end = Date.now() + ms; !(await ok()); await new Promise((r) => setTimeout(r, 50)))
    if (Date.now() > end) throw new Error("timed out");
};
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
};
const write = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const preset = (name: string, cost: string) =>
  JSON.stringify({ name, inherits: "Generic PLA", filament_cost: [cost] }, null, 4);
const CONF = (folder: string) =>
  `${JSON.stringify({ app: { preset_folder: folder } }, null, 4)}\n# MD5 checksum 0123\n`;

describe("the slicer's folder", () => {
  it("reads app.preset_folder past the checksum line; empty or missing = default", () => {
    expect(presetFolder(CONF("2054892209"))).toBe("2054892209");
    expect(presetFolder(CONF(""))).toBe("default");
    expect(presetFolder("{}\n# MD5 checksum 0123")).toBe("default");
    expect(presetFolder('{ "app": {')).toBeNull();
  });

  it("is per OS, and the Flatpak's on Linux", () => {
    const s = { config: "BambuStudio", flatpak: "com.bambulab.BambuStudio" };
    expect(configDirOf(s, "win32", { APPDATA: "C:/Roaming" }, "/h")).toBe(
      join("C:/Roaming", "BambuStudio"),
    );
    expect(configDirOf(s, "darwin", {}, "/h")).toBe(
      join("/h", "Library", "Application Support", "BambuStudio"),
    );
    expect(configDirOf(s, "linux", {}, "/h")).toBe(
      join("/h", ".var", "app", "com.bambulab.BambuStudio", "config", "BambuStudio"),
    );
  });
});

it("reports json that doesn't parse once, after it settled", async () => {
  const at = temp("presets-settle-");
  const store = openStore(at);
  store.set({ sharePresets: true, hubUrl: "http://hub", deviceId: "d" });
  write(join(at, "cfg", "user", "default", "filament", "Broken.json"), "{ not json");
  const sent: unknown[] = [];
  const share = (settleMs: number) =>
    createPresetShare({
      request: async (_, init) => {
        sent.push(init?.body);
        return Response.json({ result: "invalid", name: "Broken", version: 0 });
      },
      store,
      dataDir: at,
      slicers: () => [
        {
          id: "s",
          windowsName: "S",
          macApp: "S.app",
          flatpak: "s",
          library: "s",
          config: "S",
        },
      ],
      identity: () => "link",
      log: () => {},
      configDir: () => join(at, "cfg"),
      settleMs,
    });
  const run = async (settleMs: number) => {
    const s = share(settleMs);
    await s.start();
    s.stop();
  };
  await run(60_000);
  expect(sent).toEqual([]);
  await run(0);
  expect(sent).toHaveLength(1);
  await run(0);
  // A newer save of the same bytes isn't a change either.
  utimesSync(join(at, "cfg", "user", "default", "filament", "Broken.json"), new Date(), new Date());
  await run(0);
  expect(sent).toHaveLength(1);
});

describe("Share my presets (ADR-0017)", () => {
  const hub = async () => {
    const db = openDb(":memory:");
    const dataDir = temp("presets-hub-");
    const app = await buildApp(db, { stream: { write: () => true } }, dataDir, {
      adapters: adapters({ mock: false }),
    });
    const user = db
      .insert(schema.users)
      .values({
        email: "ana@x.io",
        displayName: "Ana",
        roleId: BUILT_IN_ROLE_IDS.admin,
        passwordHash: await hashPassword("password123"),
      })
      .returning()
      .get();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.email, password: "password123" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
      app.inject({ method, url, payload, headers: { cookie } });
    await send("PATCH", "/api/preferences", { hubEnabled: true });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    cleanup.push(() => {
      app.server.closeAllConnections();
      return app.close();
    });
    const presets = async () => (await send("GET", "/api/presets")).json() as SlicerPreset[];
    const alerts = (kind: string) =>
      db
        .select()
        .from(schema.alerts)
        .all()
        .filter((a) => a.kind === kind);
    const device = async (name: string, config = temp("presets-cfg-")) => {
      const at = temp("presets-device-");
      const store = openStore(at);
      const link = createLink({
        store,
        version: "0.0.0",
        os: "test",
        sync: { dataDir: at, syncDir: join(at, "sync") },
        presetConfigDir: () => config,
        slicers: {
          find: async (known) =>
            known
              .filter((k) => k.library === "bambu-studio")
              .map(
                (k): Found => ({
                  id: k.id,
                  name: k.windowsName,
                  version: "1",
                  path: "x",
                  cmd: "x",
                  args: [],
                  cli: { cmd: "x", args: [] },
                }),
              ),
        },
        log: () => {},
      });
      cleanup.push(() => link.close());
      const code = (await send("POST", "/api/hub/pairing-codes", { userId: user.id })).json().code;
      await link.pair(url, code, name);
      const id = store.get().deviceId as string;
      await until(async () =>
        (await send("GET", "/api/presets/devices"))
          .json()
          .some((d: { id: string; online: boolean }) => d.id === id && d.online),
      );
      const put = (body: object) =>
        fetch(`${url}/api/hub/device/presets`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${store.token()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      return {
        id,
        config,
        store,
        put,
        share: async () => {
          const res = await send("PATCH", `/api/presets/devices/${id}`, { sharePresets: true });
          expect(res.statusCode).toBe(204);
          await until(() => store.get().sharePresets === true);
        },
        file: (rel: string) => join(config, "user", rel),
      };
    };
    return { send, presets, alerts, device };
  };

  it("a saved preset reaches the hub; two edits of one version give a conflict copy", async () => {
    const h = await hub();
    const a = await h.device("Studio PC");
    const b = await h.device("Farm PC");
    write(join(a.config, "BambuStudio.conf"), CONF("123"));
    write(a.file("123/filament/Mine.json"), preset("Mine", "20"));
    write(a.file("123/filament/Mine.info"), "sync_info = create");
    // Off by default.
    await new Promise((r) => setTimeout(r, 300));
    expect(await h.presets()).toEqual([]);

    await a.share();
    await until(async () => (await h.presets()).length === 1);
    expect((await h.presets())[0]).toMatchObject({
      library: "bambu-studio",
      kind: "filament",
      name: "Mine",
      version: 1,
      savedDevice: "Studio PC",
      savedUser: "Ana",
    });

    // The same preset in the cloud's own format is no change.
    write(b.file("default/filament/Mine.json"), JSON.stringify(JSON.parse(preset("Mine", "20"))));
    await b.share();
    await new Promise((r) => setTimeout(r, 300));
    expect((await h.presets())[0]?.version).toBe(1);

    // A's edit, picked up by the watch: the next version.
    write(a.file("123/filament/Mine.json"), preset("Mine", "21"));
    await until(async () => (await h.presets())[0]?.version === 2);
    expect(h.alerts("preset_conflict")).toEqual([]);

    // B's edit also started from version 1.
    write(b.file("default/filament/Mine.json"), preset("Mine", "22"));
    await until(async () => (await h.presets()).length === 2);
    const all = await h.presets();
    expect(all.find((p) => p.name === "Mine")?.version).toBe(2);
    const copy = all.find((p) => p.conflict);
    expect(copy?.name).toMatch(/^Mine \(conflict Farm PC \d{4}-\d\d-\d\d [\d-]+\)$/);
    const json = await (await h.send("GET", `/api/presets/${copy?.id}/download`)).json();
    expect(json.name).toBe(copy?.name);
    expect(json.filament_cost).toEqual(["22"]);
    const [alert] = h.alerts("preset_conflict");
    expect(alert?.context).toMatchObject({ name: "Mine", device: "Farm PC", copy: copy?.name });

    // `.info` changes wake nothing up, and the conflict isn't sent again on a new look.
    write(a.file("123/filament/Mine.info"), "sync_info = update");
    write(b.file("default/filament/Other.json"), preset("Other", "1"));
    await until(async () => (await h.presets()).some((p) => p.name === "Other"));
    expect((await h.presets()).filter((p) => p.conflict)).toHaveLength(1);
  }, 120_000);

  it("a desktop delete only shows on the preset, until the file is back", async () => {
    const h = await hub();
    const a = await h.device("Studio PC");
    write(a.file("default/process/Fast.json"), preset("Fast", "1"));
    await a.share();
    await until(async () => (await h.presets()).length === 1);

    rmSync(a.file("default/process/Fast.json"));
    await until(async () => (await h.presets())[0]?.removedOn.length === 1);
    expect((await h.presets())[0]).toMatchObject({ removedOn: ["Studio PC"], version: 1 });

    write(a.file("default/process/Fast.json"), preset("Fast", "1"));
    await until(async () => (await h.presets())[0]?.removedOn.length === 0);
    expect((await h.presets())[0]?.version).toBe(1);
  }, 120_000);

  it("follows a sign-in to the account's folder, leaving the old one alone", async () => {
    const h = await hub();
    const a = await h.device("Studio PC");
    write(a.file("default/filament/Local.json"), preset("Local", "1"));
    await a.share();
    await until(async () => (await h.presets()).length === 1);

    write(join(a.config, "BambuStudio.conf"), CONF("123"));
    write(a.file("123/filament/Account.json"), preset("Account", "1"));
    await until(async () => (await h.presets()).length === 2);
    expect((await h.presets()).find((p) => p.name === "Local")?.removedOn).toEqual([]);
  }, 120_000);

  it("guards the device route; a hub delete stays until the preset is edited", async () => {
    const h = await hub();
    const a = await h.device("Studio PC");
    const body = { library: "bambu-studio", kind: "filament", name: "Mine", base: 0 };
    const text = preset("Mine", "20");

    expect((await a.put({ ...body, text })).status).toBe(403);
    await a.share();
    // The library names a folder on the hub.
    expect((await a.put({ ...body, library: "../../etc", text })).status).toBe(404);

    const invalid = await a.put({ ...body, text: "{ not json" });
    expect(await invalid.json()).toMatchObject({ result: "invalid", name: "Mine" });
    expect(h.alerts("preset_skipped")[0]?.context).toMatchObject({
      name: "Mine",
      from: "Studio PC",
      reason: "invalid_json",
    });
    expect(await h.presets()).toEqual([]);

    expect(await (await a.put({ ...body, text })).json()).toMatchObject({
      result: "saved",
      version: 1,
    });
    const id = (await h.presets())[0]?.id;
    expect((await h.send("DELETE", `/api/presets/${id}`)).statusCode).toBe(204);
    // Coming back through a slicer's cloud isn't an edit.
    expect(await (await a.put({ ...body, base: 1, text })).json()).toMatchObject({
      result: "same",
    });
    expect(await h.presets()).toEqual([]);
    const edited = await a.put({ ...body, base: 1, text: preset("Mine", "21") });
    expect(await edited.json()).toMatchObject({ result: "saved", version: 2 });
    expect((await h.presets()).map((p) => p.name)).toEqual(["Mine"]);
  }, 120_000);
});
