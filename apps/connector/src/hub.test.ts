// A real connector link against a real hub (the server's buildApp on a free port).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockAdapter, fixture as mockState } from "@3d-maker-suite/adapter-mock";
import {
  BUILT_IN_ROLE_IDS,
  DEVICE_GALLERY_IMAGE_MAX,
  PROJECT_TRASH_DIR,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLink, type Link, PairError, sseParser } from "./hub.ts";
import { openStore } from "./state.ts";
import { createStatusPage, t } from "./status.ts";

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

// Generous: a full parallel run slows file watching and scans down a lot.
const until = async (ok: () => boolean | Promise<boolean>, ms = 15_000) => {
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
        .values({
          email: `${role}@x.io`,
          displayName: role,
          roleId: BUILT_IN_ROLE_IDS[role],
          passwordHash,
        })
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
    return { url, send, code, admin, viewer, db };
  };

  const connector = (
    dir = mkdtempSync(join(tmpdir(), "connector-")),
    opts: Partial<Parameters<typeof createLink>[0]> = {},
  ) => {
    const store = openStore(dir);
    const link = createLink({ store, version: "5.0.0-test", os: "TestOS x64", ...opts });
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
    expect(c.link.branding().name).toBeUndefined();
    await h.send("PATCH", "/api/preferences", { appName: "Farm" });
    c.link.start();
    await until(() => c.link.branding().name === "Farm");
    await until(() => status(c.link) === "online");

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

  it("knows its hub user, follows a rename, and forgets it when unpaired", async () => {
    const h = await hub();
    const c = connector();
    vi.useFakeTimers({ toFake: ["setInterval"] });
    cleanup.push(() => vi.useRealTimers());
    expect(c.link.userName()).toBeUndefined();
    // The admin's: the one the test's session can rename.
    const made = await h.send("POST", "/api/hub/pairing-codes", { userId: h.admin.id });
    await c.link.pair(h.url, made.json().code, "WS-1");
    await until(() => c.link.userName() === "admin");

    await h.send("PATCH", "/api/auth/me", { displayName: "Zoë" });
    vi.advanceTimersByTime(15_000);
    await until(() => c.link.userName() === "Zoë");

    c.link.unpair();
    expect(c.link.userName()).toBeUndefined();
  });

  it("changes its user with a code and keeps its pairing", async () => {
    const h = await hub();
    const c = connector();
    await c.link.pair(h.url, await h.code(), "WS-1");
    await until(() => c.link.userName() === "viewer");
    const token = c.store.token();
    const [device] = (await h.send("GET", "/api/hub/devices")).json();

    const invalid = await c.link.checkUser("AAAA-AAAA").catch((e) => e);
    expect(invalid).toBeInstanceOf(PairError);
    expect(invalid.code).toBe("invalidCode");

    const made = await h.send("POST", `/api/hub/devices/${device.id}/user-code`, {
      userId: h.admin.id,
    });
    const { code } = made.json();
    expect(await c.link.checkUser(code)).toEqual({
      userName: "admin",
      currentUserName: "viewer",
      projects: 0,
    });
    expect(await c.link.changeUser(code, "move")).toEqual({ userName: "admin", moved: 0 });
    expect(c.link.userName()).toBe("admin");
    expect(c.store.token()).toBe(token);
    expect(status(c.link)).toBe("online");
    expect((await h.send("GET", "/api/hub/devices")).json()[0]).toMatchObject({
      id: device.id,
      userName: "admin",
      online: true,
    });

    const used = await c.link.changeUser(code, "move").catch((e) => e);
    expect(used.code).toBe("invalidCode");
  });

  it("changes its user on its status page, with both owner choices, and refuses a bad code", async () => {
    const h = await hub();
    const c = connector();
    await c.link.pair(h.url, await h.code(), "WS-1");
    await until(() => c.link.userName() === "viewer");
    const token = c.store.token();
    const [device] = (await h.send("GET", "/api/hub/devices")).json();
    const other = connector();
    await other.link.pair(h.url, await h.code(), "WS-2");
    const [, otherDevice] = (await h.send("GET", "/api/hub/devices")).json();

    // A project in this connector's folder and one on the hub, both the viewer's.
    const project = (number: number, location: string) => {
      const { id: rootId } = h.db
        .insert(schema.roots)
        .values({ name: location, location, path: `/${location}`, position: number })
        .returning()
        .get();
      return h.db
        .insert(schema.projects)
        .values({ number, name: `p${number}`, rootId, folder: "a", ownerId: h.viewer.id })
        .returning()
        .get().id;
    };
    const onDevice = project(1, device.id);
    const onHub = project(2, "hub");
    const ownerOf = (id: string) =>
      h.db
        .select()
        .from(schema.projects)
        .all()
        .find((p) => p.id === id)?.ownerId;

    const page = createStatusPage({
      link: c.link,
      store: c.store,
      updater: { state: () => ({ failed: undefined, hubOlder: false, error: undefined }) },
      version: "5.0.0-test",
      syncDir: join(c.dir, "sync"),
      open: () => {},
      exit: () => {},
    });
    await new Promise<void>((r) => page.listen(0, "127.0.0.1", r));
    cleanup.push(() => page.close());
    const { port } = page.address() as AddressInfo;
    // node:http: fetch can't send an Origin, and the page wants one on a POST.
    const call = (method: string, path: string, body = "") =>
      new Promise<{ status: number; body: string }>((done, fail) => {
        const req = request(
          {
            host: "127.0.0.1",
            port,
            method,
            path,
            headers: {
              host: `127.0.0.1:${port}`,
              origin: `http://127.0.0.1:${port}`,
              "content-type": "application/x-www-form-urlencoded",
            },
          },
          (res) => {
            let text = "";
            res.on("data", (d) => (text += d));
            res.on("end", () => done({ status: res.statusCode ?? 0, body: text }));
          },
        );
        req.on("error", fail);
        req.end(body);
      });
    const wrongCode = t("connector:user.errors.invalidCode");
    const codeFor = async (userId: string, id = device.id) =>
      (await h.send("POST", `/api/hub/devices/${id}/user-code`, { userId })).json().code as string;

    expect((await call("GET", "/")).body).toContain("viewer");

    // Wrong, and another device's: refused with the same message, nothing changes.
    for (const code of ["AAAA-AAAA", await codeFor(h.admin.id, otherDevice.id)]) {
      for (const path of ["/user", "/user/confirm"]) {
        const refused = await call("POST", path, `code=${code}&projects=move`);
        expect(refused.status).toBe(400);
        expect(refused.body).toContain(wrongCode);
      }
    }
    expect(c.link.userName()).toBe("viewer");
    expect(ownerOf(onDevice)).toBe(h.viewer.id);

    // Move: the folder's project goes with the connector; the hub's stays.
    const toAdmin = await codeFor(h.admin.id);
    const asked = await call("POST", "/user", `code=${toAdmin}&projects=move`);
    expect(asked.body).toContain(t("connector:user.willMove", { count: 1, name: "admin" }));
    expect(ownerOf(onDevice)).toBe(h.viewer.id); // only asked
    const moved = await call("POST", "/user/confirm", `code=${toAdmin}&projects=move`);
    expect(moved.body).toContain(t("connector:user.done", { name: "admin" }));
    expect(ownerOf(onDevice)).toBe(h.admin.id);
    expect(ownerOf(onHub)).toBe(h.viewer.id);
    expect(c.link.userName()).toBe("admin");
    expect((await call("GET", "/")).body).toContain("admin");

    // Used: refused.
    const used = await call("POST", "/user/confirm", `code=${toAdmin}&projects=move`);
    expect(used.status).toBe(400);
    expect(used.body).toContain(wrongCode);

    // Stay: the connector changes user, the project keeps its owner.
    const toViewer = await codeFor(h.viewer.id);
    const stay = await call("POST", "/user", `code=${toViewer}&projects=stay`);
    expect(stay.body).toContain(t("connector:user.willStay", { count: 1 }));
    await call("POST", "/user/confirm", `code=${toViewer}&projects=stay`);
    expect(c.link.userName()).toBe("viewer");
    expect(ownerOf(onDevice)).toBe(h.admin.id);

    // No new pairing at any point.
    expect(c.store.token()).toBe(token);
    expect(status(c.link)).toBe("online");
    expect((await h.send("GET", "/api/hub/devices")).json()[0]).toMatchObject({
      id: device.id,
      userName: "viewer",
    });
  });

  it("updates on Update now and tells the hub why it couldn't", async () => {
    const h = await hub();
    const forced: boolean[] = [];
    const c = connector(undefined, {
      onHubVersion: async (_, force) => void forced.push(force),
      updateFailure: () =>
        forced.at(-1) ? { version: "9.9.9", reason: "download", error: "HTTP 404" } : undefined,
    });
    await c.link.pair(h.url, await h.code(), "WS-1");
    await until(() => status(c.link) === "online");
    const devices = async () => (await h.send("GET", "/api/hub/devices")).json();
    const [device] = await devices();
    expect(device).toMatchObject({ outdated: true, updateFailed: null });

    expect((await h.send("POST", `/api/hub/devices/${device.id}/update`)).statusCode).toBe(204);
    await until(() => forced.includes(true));
    await until(async () => (await devices())[0].updateFailed?.error === "HTTP 404");
  });

  it("answers the hub's Edit connector requests, and restarts only after answering", async () => {
    const h = await hub();
    const calls: string[] = [];
    const c = connector(undefined, {
      settings: {
        get: () => ({ port: 4301, autostart: true }),
        set: async (patch) => {
          calls.push(`set ${JSON.stringify(patch)}`);
          return {
            port: patch.port ?? 4301,
            autostart: patch.autostart ?? true,
            restartRequired: !!patch.port,
          };
        },
        restart: () => void calls.push("restart"),
      },
    });
    await c.link.pair(h.url, await h.code(), "WS-1");
    await until(() => status(c.link) === "online");
    const [device] = (await h.send("GET", "/api/hub/devices")).json();
    const url = `/api/hub/devices/${device.id}`;

    expect((await h.send("GET", `${url}/settings`)).json()).toEqual({
      port: 4301,
      autostart: true,
    });
    const saved = await h.send("PUT", `${url}/settings`, { port: 4400 });
    expect(saved.json()).toMatchObject({ port: 4400, restartRequired: true });
    expect((await h.send("POST", `${url}/restart`)).statusCode).toBe(204);
    await until(() => calls.includes("restart"));
    expect(calls[0]).toBe('set {"port":4400}');
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
      // A new connector shares nothing: seeded empty from its (no) roots, then the folder added.
      await until(() => c.store.get().folders !== undefined);
      expect(c.store.get().folders).toEqual([]);
      expect(await c.link.roots.folders.add(root)).toBeUndefined();
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
      await until(async () => (await projects()).length === 1);
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

      // A picked cover and gallery come from the device the same way; a pick over the caps is
      // left out (shown while online, pulled).
      writeFileSync(join(root, "001_Box", "photo.png"), "photo");
      writeFileSync(join(root, "001_Box", "big.png"), Buffer.alloc(DEVICE_GALLERY_IMAGE_MAX + 1));
      await until(async () => (await projects())[0].meta.files.length === 3, 15_000);
      const image = (path: string) =>
        h.send("GET", `/api/projects/${p.id}/files/image?path=${path}`);
      expect((await image("big.png")).rawPayload.length).toBe(DEVICE_GALLERY_IMAGE_MAX + 1);
      const picked = await h.send("PATCH", `/api/projects/${p.id}`, {
        coverFile: "photo.png",
        gallery: { folders: [], images: ["photo.png", "big.png"] },
      });
      expect(picked.statusCode).toBe(200);
      await until(async () => (await thumbnail()).toString() === "photo", 15_000);
      expect((await h.send("GET", `/api/projects/${p.id}`)).json().galleryLeftOut).toEqual([
        "big.png",
      ]);

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
      expect((await image("photo.png")).rawPayload.toString()).toBe("photo");
      expect((await h.send("GET", `/api/projects/${p.id}`)).json().galleryLeftOut).toEqual([
        "big.png",
      ]);
      expect((await h.send("GET", `/api/fs/list?device=${device.id}`)).json().error.code).toBe(
        "device_offline",
      );

      // Changed while it was stopped: caught up on the next connect.
      mkdirSync(join(root, "002_Cup"));
      copyFileSync(fixture("unsliced.3mf"), join(root, "002_Cup", "cup.3mf"));
      const again = connector(c.dir);
      again.link.start();
      await until(async () => (await projects()).length === 2);
      expect((await projects()).every((x: { offline: boolean }) => !x.offline)).toBe(true);
    }, 120_000);

    it("lists and adds only inside the shared folders; an unshared root keeps its data", async () => {
      const { h, c, device, root, projects } = await setup();
      const outside = mkdtempSync(join(tmpdir(), "device-outside-"));
      cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
      const list = async (path?: string) =>
        (
          await h.send(
            "GET",
            `/api/fs/list?device=${device.id}${path === undefined ? "" : `&path=${encodeURIComponent(path)}`}`,
          )
        ).json();
      const real = realpathSync(root);
      expect((await list()).entries).toEqual([{ name: real, path: real, type: "dir" }]);
      for (const path of [outside, join(root, ".."), join(outside, "nope")])
        expect((await list(path)).error.code).toBe("path_denied");
      const denied = await h.send("POST", "/api/roots", { path: outside, location: device.id });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe("path_denied");

      const added = await h.send("POST", "/api/roots", { path: root, location: device.id });
      await until(async () => (await projects()).length === 1, 10_000);
      const [p] = await projects();
      // A root with projects keeps its shared folder.
      expect(await c.link.roots.folders.remove(real)).toBe("inUse");
      expect(c.link.roots.folders.list()).toEqual([real]);

      // Unshared on the device (e.g. by hand in state.json): last known data, never missing.
      c.store.set({ folders: [] });
      void c.link.roots.start();
      const roots = async () => (await h.send("GET", "/api/roots")).json();
      await until(async () => (await roots())[0].state === "unshared");
      expect((await roots())[0].id).toBe(added.json().id);
      expect(c.link.roots.state().watching).toBe(0);
      expect(await projects()).toMatchObject([{ id: p.id, offline: true }]);
      expect((await h.send("GET", `/api/projects/${p.id}`)).json().folderState).toBe("offline");

      // Shared again: back to ok.
      expect(await c.link.roots.folders.add(root)).toBeUndefined();
      await until(async () => (await roots())[0].state === "ok");
      expect((await projects())[0].offline).toBe(false);
    }, 30_000);

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
      const plate = { file: "box.3mf", plate: 1, processPresetId: null, filaments };
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
