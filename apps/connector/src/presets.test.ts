// A real hub (the server's buildApp on a free port) and connectors whose slicer is a temp folder.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { EOL, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BUILT_IN_ROLE_IDS, type PresetDevice, type SlicerPreset } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { extract } from "@3d-maker-suite/host";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { savePreset } from "@3d-maker-suite/server/src/integrations/presetLibrary.ts";
import { adapters } from "@3d-maker-suite/server/src/integrations/registry.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLink } from "./hub.ts";
import { configDirOf, createPresetShare, openPresetState, presetFolder } from "./presets.ts";
import type { Found } from "./slicers.ts";
import { openStore } from "./state.ts";

const until = async (ok: () => boolean | Promise<boolean>, ms = 60_000) => {
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
  store.set({
    presetLibraries: { s: { send: true, install: false } },
    hubUrl: "http://hub",
    deviceId: "d",
  });
  write(join(at, "cfg", "user", "default", "filament", "Broken.json"), "{ not json");
  const sent: unknown[] = [];
  const share = (settleMs: number) =>
    createPresetShare({
      request: async (path, init) => {
        // Not the account report (`/presets/share`).
        if (path === "/presets") sent.push(init?.body);
        return Response.json({ result: "invalid", name: "Broken", version: 0 });
      },
      store,
      state: openPresetState(at, () => "link"),
      slicers: () => [
        {
          id: "s",
          windowsName: "S",
          macApp: "S.app",
          flatpak: "s",
          library: "s",
          config: "S",
          process: "s",
          presetIndent: "    ",
          uploadsDiskEdits: true,
          cloudClockLeadS: 0,
          tombstones: false,
        },
      ],
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

describe("device presets (ADR-0017)", () => {
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
    /** Another user, whose devices aren't the presets' owner. */
    const another = (displayName: string) =>
      db
        .insert(schema.users)
        .values({
          email: `${displayName}@x.io`,
          displayName,
          roleId: BUILT_IN_ROLE_IDS.admin,
          passwordHash: "x",
        })
        .returning()
        .get().id;
    const device = async (
      name: string,
      config = temp("presets-cfg-"),
      {
        userId = user.id,
        library = "bambu-studio",
        /** A second slicer it finds, with its own config folder. */
        orca = undefined as string | undefined,
      } = {},
    ) => {
      const at = temp("presets-device-");
      const store = openStore(at);
      /** The process list this device's check sees. */
      const slicer = { running: false };
      const libraries = orca ? [library, "orca-slicer"] : [library];
      const link = createLink({
        store,
        version: "0.0.0",
        os: "test",
        sync: { dataDir: at, syncDir: join(at, "sync") },
        presetConfigDir: (s) => (orca && s.library === "orca-slicer" ? orca : config),
        presetHooks: {
          pollMs: 50,
          processes: async () =>
            `"System","4"\n${slicer.running ? '"bambu-studio.exe","99"\n"orca-slicer.exe","98"\n' : ""}`,
        },
        slicers: {
          find: async (known) =>
            known
              .filter((k) => libraries.includes(k.library))
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
      const code = (await send("POST", "/api/hub/pairing-codes", { userId })).json().code;
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
        at,
        config,
        store,
        put,
        slicer,
        share: async (lib = library) => {
          const res = await send("PATCH", `/api/hub/devices/${id}/slicers/${lib}`, {
            user: { share: true },
          });
          expect(res.statusCode).toBe(204);
          await until(() => store.get().presetLibraries?.[lib]?.send === true);
        },
        install: async (lib = library) => {
          const res = await send("PATCH", `/api/hub/devices/${id}/slicers/${lib}`, {
            user: { receive: true },
          });
          expect(res.statusCode).toBe(204);
          await until(() => store.get().presetLibraries?.[lib]?.install === true);
        },
        /** Only these kinds on its Share lines (Presets settings → Sources). */
        kinds: async (body: { shareKinds?: string[] }, lib = library) => {
          const res = await send("PATCH", `/api/hub/devices/${id}/slicers/${lib}`, {
            user: body,
          });
          expect(res.statusCode).toBe(204);
        },
        file: (rel: string) => join(config, "user", rel),
        status: async () =>
          ((await send("GET", "/api/presets/devices")).json() as PresetDevice[])
            .find((d) => d.id === id)
            ?.libraries.find((l) => l.status)?.status,
      };
    };
    /** A preset changed on the hub. */
    const save = (name: string, cost: string, kind: "filament" | "process" = "filament") =>
      savePreset(db, dataDir, { library: "bambu-studio", kind, name, json: preset(name, cost) });
    return { db, dataDir, send, presets, alerts, another, device, save };
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

  it("another user's delete is written back; the owner's goes everywhere, after a backup", async () => {
    const h = await hub();
    const a = await h.device("Studio PC");
    const b = await h.device("Farm PC", undefined, { userId: h.another("Bo") });
    write(a.file("default/process/Fast.json"), preset("Fast", "1"));
    await a.share();
    await until(async () => (await h.presets()).length === 1);
    expect((await h.presets())[0]).toMatchObject({ owner: "Ana" });
    for (const step of [b.share, b.install]) await step();
    await until(() => existsSync(b.file("default/process/Fast.json")));

    // Bo isn't the owner: nothing changes on the hub, and Install puts it back.
    rmSync(b.file("default/process/Fast.json"));
    await until(() => existsSync(b.file("default/process/Fast.json")));
    expect((await h.presets())[0]).toMatchObject({ removedOn: [], version: 1 });

    // Ana's: deleted on the hub, then on Bo's PC (signed out: the file goes).
    rmSync(a.file("default/process/Fast.json"));
    await until(async () => (await h.presets()).length === 0);
    await until(() => !existsSync(b.file("default/process/Fast.json")));
    const out = temp("presets-backup-");
    await extract(join(b.at, "preset-backups", "bambu-studio.zip"), out);
    expect(existsSync(join(out, "default/process/Fast.json"))).toBe(true);
    // Its removal doesn't come back to the hub as one of Bo's.
    await new Promise((r) => setTimeout(r, 500));
    const [gone] = (await h.send("GET", "/api/presets/deleted")).json() as SlicerPreset[];
    expect(gone).toMatchObject({ name: "Fast", savedDevice: "Studio PC" });

    // Restore brings it back to Bo's PC.
    expect((await h.send("POST", `/api/presets/${gone?.id}/restore`, {})).statusCode).toBe(200);
    await until(() => existsSync(b.file("default/process/Fast.json")));
  }, 120_000);

  it("a connector before 5.4.0's removal only shows, and its device says so", async () => {
    const h = await hub();
    const a = await h.device("Studio PC");
    write(a.file("default/process/Fast.json"), preset("Fast", "1"));
    await a.share();
    await until(async () => (await h.presets()).length === 1);
    const old = await fetch(`${a.store.get().hubUrl}/api/hub/device/presets/removed`, {
      method: "POST",
      headers: { authorization: `Bearer ${a.store.token()}`, "content-type": "application/json" },
      body: JSON.stringify({ library: "bambu-studio", kind: "process", name: "Fast" }),
    });
    expect(old.status).toBe(204);
    expect((await h.presets())[0]).toMatchObject({ removedOn: ["Studio PC"], version: 1 });
    // This test's connector says 0.0.0.
    const devices = (await h.send("GET", "/api/presets/devices")).json() as PresetDevice[];
    expect(devices[0]?.outdated).toBe(true);
  }, 120_000);

  it("a move within its folder isn't a delete; a mass delete waits, and Keep writes it back", async () => {
    const h = await hub();
    await h.send("PATCH", "/api/preferences", { hubDeleteGuard: 1 });
    const a = await h.device("Studio PC");
    write(a.file("default/filament/Moved.json"), preset("Moved", "1"));
    write(a.file("default/filament/Two.json"), preset("Two", "1"));
    await a.share();
    await until(async () => (await h.presets()).length === 2);

    rmSync(a.file("default/filament/Moved.json"));
    write(a.file("default/filament/base/Moved.json"), preset("Moved", "1"));
    await new Promise((r) => setTimeout(r, 1500));
    expect((await h.presets()).map((p) => [p.name, p.removedOn])).toEqual([
      ["Moved", []],
      ["Two", []],
    ]);

    await a.install();
    rmSync(a.file("default/filament/base/Moved.json"));
    rmSync(a.file("default/filament/Two.json"));
    await until(async () => (await h.presets()).every((p) => p.held?.reason === "mass"));
    await until(() => h.alerts("preset_held").length === 1);
    expect(h.alerts("preset_held")[0]?.context).toMatchObject({ name: "Studio PC", count: 2 });
    // Held: not written back meanwhile.
    await new Promise((r) => setTimeout(r, 500));
    expect(existsSync(a.file("default/filament/Two.json"))).toBe(false);

    const res = await h.send("POST", `/api/presets/devices/${a.id}/held`, { action: "keep" });
    expect(res.statusCode).toBe(204);
    await until(() => existsSync(a.file("default/filament/Two.json")));
    // Its old path is gone, so it comes back where a new one goes.
    await until(() => existsSync(a.file("default/filament/Moved.json")));
    expect((await h.presets()).every((p) => !p.held && !p.removedOn.length)).toBe(true);
  }, 120_000);

  it("a shared slicer account holds the owner's delete", async () => {
    const h = await hub();
    const a = await h.device("Studio PC");
    const b = await h.device("Farm PC", undefined, { userId: h.another("Bo") });
    for (const d of [a, b]) write(join(d.config, "BambuStudio.conf"), CONF("123"));
    write(b.file("123/filament/Theirs.json"), preset("Theirs", "1"));
    write(a.file("123/filament/Mine.json"), preset("Mine", "1"));
    await b.share();
    await a.share();
    await until(async () => (await h.presets()).length === 2);

    rmSync(a.file("123/filament/Mine.json"));
    await until(
      async () => (await h.presets()).find((p) => p.name === "Mine")?.held?.reason === "shared",
    );
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
    // The library names a folder on the hub: one with no switch is refused, and none can be set.
    expect((await a.put({ ...body, library: "../../etc", text })).status).toBe(403);
    const junk = { user: { share: true } };
    const lib = encodeURIComponent("../../etc");
    expect(
      (await h.send("PATCH", `/api/hub/devices/${a.id}/slicers/${lib}`, junk)).statusCode,
    ).toBe(404);

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

  it("sends one slicer's presets and not the other's (ADR-0020)", async () => {
    const h = await hub();
    const orca = temp("presets-orca-");
    const a = await h.device("Studio PC", undefined, { orca });
    write(a.file("default/filament/Studio PLA.json"), preset("Studio PLA", "20"));
    write(join(orca, "user", "default", "filament", "Orca PLA.json"), preset("Orca PLA", "20"));
    await a.share("orca-slicer");
    await until(async () => (await h.presets()).length === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect((await h.presets()).map((p) => [p.library, p.name])).toEqual([
      ["orca-slicer", "Orca PLA"],
    ]);
    // The other slicer's route stays shut.
    const body = { library: "bambu-studio", kind: "filament", name: "X", base: 0 };
    const res = await a.put({ ...body, text: preset("X", "1") });
    expect(res.status).toBe(403);
    // The table has a row per slicer, with when one last sent.
    const [d] = (await h.send("GET", "/api/presets/devices")).json() as PresetDevice[];
    expect(d?.libraries.map((l) => [l.library, l.send, !!l.sentAt])).toEqual([
      ["bambu-studio", false, false],
      ["orca-slicer", true, true],
    ]);
  }, 120_000);

  it("shares only the kinds whose line is on; an off kind's removals are ignored (ADR-0021)", async () => {
    const h = await hub();
    const a = await h.device("Studio PC");
    await a.share();
    const filament = { library: "bambu-studio", kind: "filament", name: "PLA", base: 0 };
    const process = { library: "bambu-studio", kind: "process", name: "Fine", base: 0 };
    expect((await (await a.put({ ...process, text: preset("Fine", "1") })).json()).result).toBe(
      "saved",
    );
    await a.kinds({ shareKinds: ["filament"] });
    // Answered as stored, so an older connector doesn't retry it; nothing is kept.
    expect(await (await a.put({ ...process, base: 1, text: preset("Fine", "2") })).json()).toEqual({
      result: "same",
      name: "Fine",
      version: 1,
    });
    expect(await (await a.put({ ...filament, text: preset("PLA", "20") })).json()).toMatchObject({
      result: "saved",
    });
    const removals = await fetch(`${a.store.get().hubUrl}/api/hub/device/presets/removals`, {
      method: "POST",
      headers: { authorization: `Bearer ${a.store.token()}`, "content-type": "application/json" },
      body: JSON.stringify({
        library: "bambu-studio",
        account: "default",
        removed: [{ kind: "process", name: "Fine" }],
      }),
    });
    expect(await removals.json()).toEqual([{ kind: "process", name: "Fine", result: "unknown" }]);
    expect(
      (await h.presets()).map((p) => [p.kind, p.name, p.version, p.removedOn.length]).sort(),
    ).toEqual([
      ["filament", "PLA", 1, 0],
      ["process", "Fine", 1, 0],
    ]);
    // The line off keeps the hub's rows.
    expect((await h.send("GET", "/api/presets/devices")).json()[0].libraries[0]).toMatchObject({
      shareKinds: ["filament"],
    });
  }, 120_000);

  describe("Install hub presets", () => {
    const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));
    const SYSTEM = "system/BBL/filament/Generic PLA.json";
    const withSystem = (config: string) =>
      write(join(config, SYSTEM), JSON.stringify({ name: "Generic PLA", setting_id: "GFSA04" }));
    const text = (file: string) => readFileSync(file, "utf8");
    /** A device on account 123, with the system preset the test presets inherit from. */
    const signedIn = async (h: Awaited<ReturnType<typeof hub>>, name = "Studio PC") => {
      const d = await h.device(name);
      withSystem(d.config);
      write(join(d.config, "BambuStudio.conf"), CONF("123"));
      // There from the start, as on a slicer that ran: Share's watch needs it.
      mkdirSync(d.file("123/filament"), { recursive: true });
      return d;
    };
    const backup = (d: { at: string }) => join(d.at, "preset-backups", "bambu-studio.zip");

    it("is off by default; a closed slicer gets the json in its style and a create .info", async () => {
      const h = await hub();
      const a = await signedIn(h);
      h.save("Farm PLA", "20");
      await pause();
      expect(existsSync(a.file("123/filament/Farm PLA.json"))).toBe(false);
      const off = await fetch(`${a.store.get().hubUrl}/api/hub/device/presets`, {
        headers: { authorization: `Bearer ${a.store.token()}` },
      });
      expect(off.status).toBe(403);

      const before = Math.floor(Date.now() / 1000);
      await a.install();
      await until(() => existsSync(a.file("123/filament/Farm PLA.json")));
      expect(text(a.file("123/filament/Farm PLA.json"))).toBe(
        [
          "{",
          '    "filament_cost": [',
          '        "20"',
          "    ],",
          '    "inherits": "Generic PLA",',
          '    "name": "Farm PLA"',
          "}",
          "",
        ].join(EOL),
      );
      const info = text(a.file("123/filament/Farm PLA.info"));
      expect(info).toMatch(
        /^sync_info = create\nuser_id = 123\nsetting_id = \nbase_id = GFSA04\nupdated_time = \d+\n$/,
      );
      expect(Number(/updated_time = (\d+)/.exec(info)?.[1])).toBeGreaterThanOrEqual(before);
      await until(async () => !!(await a.status())?.backup);
      expect(await a.status()).toMatchObject({
        library: "bambu-studio",
        folder: join(a.config, "user", "123"),
        waiting: false,
        queued: 0,
        editsStayLocal: false,
      });
    }, 120_000);

    it("installs every kind (ADR-0023)", async () => {
      const h = await hub();
      const a = await signedIn(h);
      // Its parent, as a slicer ships it: without one the process preset is skipped.
      write(
        join(a.config, "system/BBL/process/Generic PLA.json"),
        JSON.stringify({ name: "Generic PLA", setting_id: "GP001" }),
      );
      h.save("Fine", "1", "process");
      h.save("Farm PLA", "20");
      await a.install();
      await until(() => existsSync(a.file("123/filament/Farm PLA.json")));
      const list = await fetch(`${a.store.get().hubUrl}/api/hub/device/presets`, {
        headers: { authorization: `Bearer ${a.store.token()}` },
      });
      expect((await list.json()).map((p: { name: string }) => p.name)).toEqual([
        "Farm PLA",
        "Fine",
      ]);
      await until(() => existsSync(a.file("123/process/Fine.json")));
    }, 120_000);

    it("waits while the slicer runs, and then writes", async () => {
      const h = await hub();
      const a = await signedIn(h);
      a.slicer.running = true;
      h.save("Farm PLA", "20");
      await a.install();
      await until(async () => (await a.status())?.waiting === true);
      expect(await a.status()).toMatchObject({
        queued: 1,
        queue: [{ kind: "filament", name: "Farm PLA" }],
      });
      expect(existsSync(a.file("123/filament/Farm PLA.json"))).toBe(false);
      expect(existsSync(backup(a))).toBe(false);

      a.slicer.running = false;
      await until(() => existsSync(a.file("123/filament/Farm PLA.json")));
      await until(async () => (await a.status())?.queued === 0);
    }, 120_000);

    it("the same content doesn't wait for a closed slicer", async () => {
      const h = await hub();
      const a = await signedIn(h);
      a.slicer.running = true;
      const file = a.file("123/filament/Farm PLA.json");
      write(file, preset("Farm PLA", "20"));
      const was = statSync(file).mtimeMs;
      h.save("Farm PLA", "20");
      await a.install();
      await until(async () => (await a.status())?.queued === 0);
      expect(await a.status()).toMatchObject({ waiting: false, queue: [] });
      expect(statSync(file).mtimeMs).toBe(was);
    }, 120_000);

    it("writes no .info signed out", async () => {
      const h = await hub();
      const a = await h.device("Studio PC");
      withSystem(a.config);
      h.save("Farm PLA", "20");
      await a.install();
      await until(() => existsSync(a.file("default/filament/Farm PLA.json")));
      expect(readdirSync(a.file("default/filament"))).toEqual(["Farm PLA.json"]);
    }, 120_000);

    it("keeps a cloud copy's setting_id; the same sha writes nothing; a backup holds the old file", async () => {
      const h = await hub();
      const a = await signedIn(h);
      // Further ahead than the update's lead: only going up from it wins.
      const far = Math.floor(Date.now() / 1000) + 24 * 3600;
      write(a.file("123/filament/Edited.json"), preset("Edited", "1"));
      write(
        a.file("123/filament/Edited.info"),
        `sync_info = \nuser_id = 123\nsetting_id = PFUS1\nbase_id = GFSA19\nupdated_time = ${far}\n`,
      );
      // Same content in the cloud's format.
      const same = a.file("123/filament/Same.json");
      write(same, JSON.stringify(JSON.parse(preset("Same", "5"))));
      const was = statSync(same).mtimeMs;
      h.save("Same", "5");
      await a.install();
      await until(async () => (await a.status())?.queued === 0);
      expect(statSync(same).mtimeMs).toBe(was);
      expect(existsSync(a.file("123/filament/Same.info"))).toBe(false);
      expect(existsSync(backup(a))).toBe(false);

      h.save("Edited", "2");
      await until(() => text(a.file("123/filament/Edited.json")).includes('"2"'));
      expect(text(a.file("123/filament/Edited.info"))).toBe(
        `sync_info = update\nuser_id = 123\nsetting_id = PFUS1\nbase_id = GFSA19\nupdated_time = ${far + 1}\n`,
      );

      const out = temp("presets-backup-");
      await extract(backup(a), out);
      expect(JSON.parse(text(join(out, "123/filament/Edited.json"))).filament_cost).toEqual(["1"]);

      // Only the last one stays: it has the file as the next batch found it.
      h.save("Edited", "3");
      await until(() => text(a.file("123/filament/Edited.json")).includes('"3"'));
      expect(readdirSync(dirname(backup(a)))).toEqual(["bambu-studio.zip"]);
      const next = temp("presets-backup-");
      await extract(backup(a), next);
      expect(JSON.parse(text(join(next, "123/filament/Edited.json"))).filament_cost).toEqual(["2"]);
    }, 120_000);

    it("skips and alerts on a missing parent; without readable system presets it installs", async () => {
      const h = await hub();
      const a = await signedIn(h);
      const lost = JSON.stringify({ name: "Lost", inherits: "No Such Parent" });
      h.save("Fine", "1");
      savePreset(h.db, h.dataDir, {
        library: "bambu-studio",
        kind: "filament",
        name: "Lost",
        json: lost,
      });
      await a.install();
      await until(() => h.alerts("preset_skipped").length === 1);
      expect(h.alerts("preset_skipped")[0]?.context).toMatchObject({
        name: "Lost",
        from: "Studio PC",
        reason: "missing_parent",
      });
      await until(() => existsSync(a.file("123/filament/Fine.json")));
      expect(existsSync(a.file("123/filament/Lost.json"))).toBe(false);
      await until(async () => (await a.status())?.queued === 0);

      // Orca ≥ 2.5: its system presets are binary, so the parent can't be checked.
      const b = await h.device("Orca PC");
      write(join(b.config, "BambuStudio.conf"), CONF("456"));
      write(join(b.config, "system", "BBL.opc"), "ZCRO");
      await b.install();
      await until(() => existsSync(b.file("456/filament/Lost.json")));
      expect(text(b.file("456/filament/Lost.info"))).toContain("base_id = \n");
    }, 120_000);

    it("a signed-in Studio lists a hub delete for a person; writes back a desktop delete", async () => {
      const h = await hub();
      const a = await signedIn(h);
      const row = h.save("Farm PLA", "20");
      h.save("../../evil", "1");
      h.save("Farm PLA (conflict Other PC 2026-11-02 10-00)", "9");
      await a.install();
      await until(() => existsSync(a.file("123/filament/Farm PLA.json")));
      await until(async () => (await a.status())?.queued === 0);
      expect(readdirSync(a.file("123/filament")).sort()).toEqual([
        "..-..-evil.info",
        "..-..-evil.json",
        "Farm PLA.info",
        "Farm PLA.json",
      ]);

      // Studio's cloud brings back a file deleted from disk: a person deletes it in the slicer.
      expect((await h.send("DELETE", `/api/presets/${row?.id}`)).statusCode).toBe(204);
      await until(async () => (await a.status())?.deleteHere.length === 1);
      expect((await a.status())?.deleteHere).toEqual([
        { library: "bambu-studio", kind: "filament", name: "Farm PLA" },
      ]);
      expect(existsSync(a.file("123/filament/Farm PLA.json"))).toBe(true);
      rmSync(a.file("123/filament/Farm PLA.json"));
      await until(async () => (await a.status())?.deleteHere.length === 0);

      // A desktop delete the hub doesn't act on (Share is off here) is written back.
      h.save("Silk", "1");
      await until(() => existsSync(a.file("123/filament/Silk.json")));
      rmSync(a.file("123/filament/Silk.json"));
      await until(() => existsSync(a.file("123/filament/Silk.json")));

      // Another account's folder gets its own copies.
      write(join(a.config, "BambuStudio.conf"), CONF("789"));
      await until(() => existsSync(a.file("789/filament/Silk.json")));
      expect(text(a.file("789/filament/Silk.info"))).toContain("user_id = 789");
    }, 120_000);

    it("a hub delete is a tombstone in an Orca account; an unsent edit is kept, and wins", async () => {
      const h = await hub();
      const o = await h.device("Orca PC", undefined, { library: "orca-slicer" });
      write(join(o.config, "OrcaSlicer.conf"), CONF("abc"));
      const orca = (name: string, cost: string) =>
        savePreset(h.db, h.dataDir, {
          library: "orca-slicer",
          kind: "filament",
          name,
          json: preset(name, cost),
        });
      orca("Gone", "1");
      orca("Edited", "1");
      await o.install();
      const GONE = "abc/filament/Gone.json";
      const EDITED = "abc/filament/Edited.json";
      await until(() => existsSync(o.file(GONE)) && existsSync(o.file(EDITED)));
      // Share is off here, so this edit hasn't reached the hub.
      write(o.file(EDITED), preset("Edited", "2"));
      for (const p of await h.presets())
        expect((await h.send("DELETE", `/api/presets/${p.id}`)).statusCode).toBe(204);

      // Orca deletes the cloud copy at its next start.
      await until(() => !existsSync(o.file(GONE)));
      expect(text(o.file("abc/filament/Gone.info"))).toMatch(
        /^sync_info = delete\nuser_id = abc\n/,
      );
      await until(async () => (await o.status())?.queued === 0);
      expect(text(o.file(EDITED))).toContain('"2"');
      await o.share();
      await until(async () => (await h.presets()).map((p) => p.name).includes("Edited"));
    }, 120_000);

    it("doesn't echo: no new versions, no false conflicts, no older copy from a cloud", async () => {
      const h = await hub();
      const a = await signedIn(h);
      const first = h.save("Farm PLA", "20");
      await a.install();
      await until(() => existsSync(a.file("123/filament/Farm PLA.json")));
      // Share knows the file came from the hub, so turning it on has nothing to send.
      const known = () =>
        JSON.parse(text(join(a.at, "presets.json"))).files[
          "bambu-studio/123/filament/Farm PLA.json"
        ];
      await until(() => existsSync(join(a.at, "presets.json")) && !!known());
      expect(known()).toMatchObject({ sha: first?.sha256, base: 1, name: "Farm PLA" });
      await a.share();
      await pause(1500);
      expect((await h.presets())[0]?.version).toBe(1);

      // Installed from version 2, and the hub is at 3 before Share looks at the file again.
      h.save("Farm PLA", "21");
      await until(() => text(a.file("123/filament/Farm PLA.json")).includes('"21"'));
      a.slicer.running = true;
      h.save("Farm PLA", "22");
      await pause(1500);
      expect((await h.presets()).filter((p) => p.conflict)).toEqual([]);
      expect((await h.presets())[0]?.version).toBe(3);
      a.slicer.running = false;
      await until(() => text(a.file("123/filament/Farm PLA.json")).includes('"22"'));

      // Orca's cloud puts its older copy back at start: that doesn't undo the hub's edit.
      write(a.file("123/filament/Farm PLA.json"), preset("Farm PLA", "20"));
      await pause(1500);
      expect((await h.presets()).filter((p) => p.conflict)).toEqual([]);
      expect((await h.presets())[0]?.version).toBe(3);
      expect(h.alerts("preset_conflict")).toEqual([]);

      // A real edit still goes up.
      write(a.file("123/filament/Farm PLA.json"), preset("Farm PLA", "30"));
      await until(async () => (await h.presets())[0]?.version === 4);
    }, 120_000);

    it("a hub edit right after a create beats the cloud's newer time", async () => {
      const h = await hub();
      const a = await signedIn(h);
      h.save("Farm PLA", "20");
      await a.install();
      const INFO = "123/filament/Farm PLA.info";
      await until(() => existsSync(a.file(INFO)));
      // Studio uploaded it: the time it stores is 7 h ahead, the cloud's copy 8 h.
      const now = Math.floor(Date.now() / 1000);
      write(
        a.file(INFO),
        `sync_info = \nuser_id = 123\nsetting_id = PFUS1\nbase_id = GFSA04\nupdated_time = ${now + 7 * 3600}\n`,
      );
      h.save("Farm PLA", "21");
      await until(() => text(a.file(INFO)).includes("sync_info = update"));
      const time = Number(/updated_time = (\d+)/.exec(text(a.file(INFO)))?.[1]);
      expect(time).toBeGreaterThan(now + 8 * 3600);
    }, 120_000);

    it("a cloud that drops a value the parent has makes one more version, then settles", async () => {
      const h = await hub();
      const a = await signedIn(h, "PC A");
      const b = await signedIn(h, "PC B");
      for (const d of [a, b]) {
        await d.share();
        await d.install();
      }
      const FILE = "123/filament/Farm PLA.json";
      h.save("Farm PLA", "20");
      await until(() => existsSync(a.file(FILE)) && existsSync(b.file(FILE)));
      await pause(1500);
      // PC B downloads the cloud's copy, as Studio does.
      const { filament_cost: _, ...normal } = JSON.parse(text(b.file(FILE)));
      write(b.file(FILE), JSON.stringify(normal));
      await until(async () => (await h.presets())[0]?.version === 2);
      await until(() => !text(a.file(FILE)).includes("filament_cost"));
      await pause(2000);
      expect((await h.presets()).map((p) => [p.name, p.version])).toEqual([["Farm PLA", 2]]);
      expect(h.alerts("preset_conflict")).toEqual([]);
    }, 120_000);

    it("two workstations on one account settle", async () => {
      const h = await hub();
      const a = await signedIn(h, "PC A");
      const b = await signedIn(h, "PC B");
      for (const d of [a, b]) {
        await d.share();
        await d.install();
      }
      const FILE = "123/filament/Farm PLA.json";
      /** What a slicer's cloud does: the other PC gets the file re-serialized, with its own `.info`. */
      const cloud = (from: typeof a, to: typeof a, id: string) => {
        write(to.file(FILE), JSON.stringify(JSON.parse(text(from.file(FILE)))));
        write(
          to.file(FILE.replace(".json", ".info")),
          `sync_info = \nuser_id = 123\nsetting_id = ${id}\nbase_id = GFSA04\nupdated_time = 1\n`,
        );
      };
      for (const cost of ["20", "21", "22"]) {
        h.save("Farm PLA", cost);
        await until(
          () =>
            existsSync(a.file(FILE)) &&
            existsSync(b.file(FILE)) &&
            text(a.file(FILE)).includes(`"${cost}"`) &&
            text(b.file(FILE)).includes(`"${cost}"`),
        );
        cloud(a, b, "PFUS1");
        cloud(b, a, "PFUS1");
        await pause(1500);
      }
      const all = await h.presets();
      expect(all.map((p) => [p.name, p.version])).toEqual([["Farm PLA", 3]]);
      expect(h.alerts("preset_conflict")).toEqual([]);
      // The next hub edit is an update on both: the cloud copy's id stays.
      h.save("Farm PLA", "23");
      for (const d of [a, b]) {
        await until(() => text(d.file(FILE)).includes('"23"'));
        await until(() =>
          text(d.file(FILE.replace(".json", ".info"))).includes("sync_info = update"),
        );
        expect(text(d.file(FILE.replace(".json", ".info")))).toContain("setting_id = PFUS1");
      }
    }, 120_000);
  });
});
