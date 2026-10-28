// A real connector link against a real hub (the server's buildApp on a free port).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockAdapter, fixture as mockState } from "@3d-maker-suite/adapter-mock";
import { PROJECT_TRASH_DIR } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLink, type Link, PairError, sseParser } from "./hub.ts";
import { openStore } from "./state.ts";

describe("sseParser", () => {
  it("splits events across chunks, joins data lines and skips comments", () => {
    const got: unknown[] = [];
    const feed = sseParser((e) => got.push(e));
    feed(": open\n\nid: 1\nevent: a\nda");
    feed('ta: {"x":1}\n\n: hb\n\nid: 2\ndata: one\ndata: two\n\n');
    expect(got).toEqual([
      { id: "1", event: "a", data: '{"x":1}' },
      { id: "2", data: "one\ntwo" },
    ]);
  });
});

const until = async (ok: () => boolean | Promise<boolean>, ms = 5000) => {
  for (const end = Date.now() + ms; !(await ok()); await new Promise((r) => setTimeout(r, 20)))
    if (Date.now() > end) throw new Error("timed out");
};

describe("connector and hub", () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    // Last in, first out: links stop before their hub closes.
    for (const f of cleanup.splice(0).reverse()) await f();
  });

  const hub = async (opts: Parameters<typeof buildApp>[3] = {}) => {
    const db = openDb(":memory:");
    // A data dir of its own: a device folder's cover lands in <dataDir>/thumbnails.
    const dataDir = mkdtempSync(join(tmpdir(), "hub-data-"));
    const app = await buildApp(db, { stream: { write: () => true } }, dataDir, opts);
    const passwordHash = await hashPassword("password123");
    const user = (role: "admin" | "viewer") =>
      db
        .insert(schema.users)
        .values({ email: `${role}@x.io`, displayName: role, role, passwordHash })
        .returning()
        .get();
    const admin = user("admin");
    const viewer = user("viewer");
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: admin.email, password: "password123" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    const send = (
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      url: string,
      payload?: object,
    ) => app.inject({ method, url, payload, headers: { cookie } });
    await send("PATCH", "/api/preferences", { hubEnabled: true });
    const code = async () =>
      (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json().code as string;
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    cleanup.push(() => {
      // A request aborted while connecting (the link restarts) can leave undici a connected socket
      // that never sends a request; server.close() would wait for it until the headers timeout.
      app.server.closeAllConnections();
      return app.close().finally(() => rmSync(dataDir, { recursive: true, force: true }));
    });
    return { url, send, code };
  };

  const connector = (dir = mkdtempSync(join(tmpdir(), "connector-"))) => {
    const store = openStore(dir);
    const link = createLink({ store, version: "5.0.0-test", os: "TestOS x64" });
    cleanup.push(() => link.close());
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    return { dir, store, link };
  };
  const status = (link: Link) => link.state().status;

  it("pairs, shows online, gets renamed live and after a reconnect, and stops when revoked", async () => {
    const h = await hub();
    const c = connector();
    expect(status(c.link)).toBe("unpaired");

    await expect(c.link.pair(h.url, "AAAA-AAAA", "WS-1")).rejects.toThrow(PairError);
    await c.link.pair(`${h.url}/`, await h.code(), "WS-1");
    await until(() => status(c.link) === "online");
    expect(c.store.token()).toBeTruthy();

    const [device] = (await h.send("GET", "/api/hub/devices")).json();
    expect(device).toMatchObject({
      name: "WS-1",
      online: true,
      connectorVersion: "5.0.0-test",
      os: "TestOS x64",
    });

    await h.send("PATCH", `/api/hub/devices/${device.id}`, { name: "Laptop" });
    await until(() => c.store.get().deviceName === "Laptop");

    // Offline while renamed: the next start replays it from the cursor.
    c.link.close();
    await h.send("PATCH", `/api/hub/devices/${device.id}`, { name: "Desk" });
    const again = connector(c.dir);
    again.link.start();
    await until(() => again.store.get().deviceName === "Desk");

    await h.send("DELETE", `/api/hub/devices/${device.id}`);
    await until(() => status(again.link) === "revoked");
    expect(again.store.token()).toBeUndefined();
    expect(again.store.get().hubUrl).toBe(h.url); // kept for the pair form
  });

  it("tells the hub being off apart from a revoke", async () => {
    const h = await hub();
    const c = connector();
    await c.link.pair(h.url, await h.code(), "WS-1");
    await until(() => status(c.link) === "online");
    await h.send("PATCH", "/api/preferences", { hubEnabled: false });
    // The heartbeat ends the stream within 15 s; restarting the link reconnects at once.
    c.link.start();
    await until(() => status(c.link) === "hubOff");
    expect(c.store.token()).toBeTruthy();
  });

  describe("device roots", () => {
    const fixture = (name: string) =>
      fileURLToPath(new URL(`../../../packages/3mf/fixtures/${name}`, import.meta.url));
    /** A paired, online connector and a folder on "its" disk with one project in it. */
    const setup = async (opts?: Parameters<typeof hub>[0]) => {
      const h = await hub(opts);
      const c = connector();
      await c.link.pair(h.url, await h.code(), "WS-1");
      await until(() => status(c.link) === "online");
      const [device] = (await h.send("GET", "/api/hub/devices")).json();
      const root = mkdtempSync(join(tmpdir(), "device-root-"));
      cleanup.push(() => rmSync(root, { recursive: true, force: true }));
      mkdirSync(join(root, "001_Box"));
      copyFileSync(fixture("single_color.3mf"), join(root, "001_Box", "box.3mf"));
      const projects = async () => (await h.send("GET", "/api/projects")).json().items;
      return { h, c, device, root, projects };
    };

    it("indexes a device root, updates after a save, and shows offline", async () => {
      const { h, c, device, root, projects } = await setup();

      // The folder browser goes through the connector.
      const listed = (
        await h.send("GET", `/api/fs/list?device=${device.id}&path=${encodeURIComponent(root)}`)
      ).json();
      expect(listed.entries.map((e: { name: string }) => e.name)).toEqual(["001_Box"]);
      expect(
        (
          await h.send("POST", "/api/roots", { path: join(root, "nope"), location: device.id })
        ).json().error.code,
      ).toBe("invalid_folder");

      const added = await h.send("POST", "/api/roots", { path: root, location: device.id });
      expect(added.statusCode).toBe(201);
      expect(added.json()).toMatchObject({ location: device.id, state: "ok", deviceName: "WS-1" });
      await until(() => c.link.roots.state().watching === 1);
      await until(async () => (await projects()).length === 1, 10_000);
      const [p] = await projects();
      expect(p).toMatchObject({ name: "Box", offline: false, meta: { multicolor: false } });
      expect((await h.send("GET", `/api/projects/${p.id}`)).json().folderState).toBe("ok");

      // Plate previews came with the scan; the cover is the first plate's.
      const entry = p.meta.models[0].plates[0].thumbnail;
      const preview = async () =>
        (await h.send("GET", `/api/projects/${p.id}/file?path=box.3mf&entry=${entry}`)).rawPayload;
      const thumbnail = async () =>
        (await h.send("GET", `/api/projects/${p.id}/thumbnail`)).rawPayload;
      const first = await preview();
      expect(first.subarray(1, 4).toString()).toBe("PNG");
      expect(first.equals(await thumbnail())).toBe(true);

      // A picked cover comes from the device the same way.
      writeFileSync(join(root, "001_Box", "photo.png"), "photo");
      await until(async () => (await projects())[0].meta.files.length === 2, 15_000);
      await h.send("PATCH", `/api/projects/${p.id}`, { coverFile: "photo.png" });
      await until(async () => (await thumbnail()).toString() === "photo", 15_000);

      // A slicer's save: write <file>.tmp, rename it over the file.
      const file = join(root, "001_Box", "box.3mf");
      copyFileSync(fixture("multi_color.3mf"), `${file}.tmp`);
      renameSync(`${file}.tmp`, file);
      await until(async () => (await projects())[0].meta.multicolor, 15_000);
      const saved = await preview();
      expect(saved.equals(first)).toBe(false);
      expect((await thumbnail()).toString()).toBe("photo");

      // The connector stops: last known data, offline.
      c.link.close();
      await until(async () => (await projects())[0].offline);
      expect((await h.send("GET", `/api/projects/${p.id}`)).json().folderState).toBe("offline");
      expect((await h.send("GET", "/api/roots")).json()[0].state).toBe("offline");
      expect((await preview()).equals(saved)).toBe(true);
      expect((await h.send("GET", `/api/fs/list?device=${device.id}`)).json().error.code).toBe(
        "device_offline",
      );

      // Changed while it was stopped: caught up on the next connect.
      mkdirSync(join(root, "002_Cup"));
      copyFileSync(fixture("unsliced.3mf"), join(root, "002_Cup", "cup.3mf"));
      const again = connector(c.dir);
      again.link.start();
      await until(async () => (await projects()).length === 2, 10_000);
      expect((await projects()).every((x: { offline: boolean }) => !x.offline)).toBe(true);
    }, 40_000);

    it("pulls a file when needed, slices it on the hub, and writes on the device", async () => {
      const mock = mockState();
      const { h, device, root, projects } = await setup({ adapters: [mockAdapter(mock)] });
      const rootId = (
        await h.send("POST", "/api/roots", { path: root, location: device.id })
      ).json().id;
      await until(async () => (await projects()).length === 1, 10_000);
      const [p] = await projects();
      const box = join(root, "001_Box", "box.3mf");

      // Download and the 3D view: pulled from the device, checked by its hash.
      const file = await h.send("GET", `/api/projects/${p.id}/file?path=box.3mf`);
      expect(file.statusCode).toBe(200);
      expect(file.rawPayload.equals(readFileSync(box))).toBe(true);
      expect((await h.send("GET", `/api/projects/${p.id}/paint?path=box.3mf`)).statusCode).toBe(
        200,
      );
      // Only files its scan lists are ever asked for.
      for (const path of ["../../outside.3mf", "box.3mf/../../x.3mf", "nope.3mf"])
        expect(
          (await h.send("GET", `/api/projects/${p.id}/file?${new URLSearchParams({ path })}`))
            .statusCode,
        ).toBe(404);

      // Sliced on the hub.
      const slicer = (
        await h.send("POST", "/api/integrations", { adapterId: "mock", secrets: { token: "t" } })
      ).json().id;
      await h.send("PATCH", `/api/integrations/${slicer}`, { slicerPath: process.execPath });
      // Its plate uses slot 4: auto slicing keeps a setup that maps every slot.
      const filaments = [null, null, null, null];
      const plate = { file: "box.3mf", plate: 1, printProfileId: null, filaments };
      expect(
        (await h.send("PUT", `/api/projects/${p.id}/slicing`, { plates: [plate] })).statusCode,
      ).toBe(200);
      await h.send("POST", `/api/projects/${p.id}/slicing/run`);
      const slicing = async () => (await h.send("GET", `/api/projects/${p.id}/slicing`)).json();
      await until(async () => (await slicing()).plates[0].needsSlicing === false);
      expect(mock.sliced).toHaveLength(1);
      expect((await slicing()).plates[0].state).toBe("ok");

      // Saved with other bytes on the device: auto slicing pulls it and slices again.
      const saved = readFileSync(box);
      // The same 3MF with a zip comment: other bytes, the same plates.
      const comment = Buffer.from("save");
      writeFileSync(
        `${box}.tmp`,
        Buffer.concat([saved.subarray(0, -2), Buffer.from([comment.length, 0]), comment]),
      );
      renameSync(`${box}.tmp`, box);
      await until(() => mock.sliced?.length === 2, 15_000);

      // A new project's folder is made on the device, and trashed there.
      const made = await h.send("POST", "/api/projects", {
        name: "Cup",
        createFolder: true,
        rootId,
      });
      expect(made.statusCode).toBe(201);
      const cup = made.json();
      expect(existsSync(cup.folderPath)).toBe(true);
      expect((await h.send("GET", `/api/projects/${cup.id}`)).json().folderState).toBe("ok");
      const trashed = await h.send("DELETE", `/api/projects/${cup.id}/folder?files=trash`);
      expect(trashed.statusCode).toBe(200);
      expect(trashed.json().trashedTo).toContain(PROJECT_TRASH_DIR);
      expect(existsSync(cup.folderPath)).toBe(false);
      expect(readdirSync(join(root, PROJECT_TRASH_DIR))).toHaveLength(1);
    }, 60_000);
  });
});
