import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILT_IN_ROLE_IDS, emptyPresetLibrary } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { buildApp } from "./app.ts";
import { adapters } from "./integrations/registry.ts";
import { hashPassword } from "./lib/password.ts";
import { VERSION } from "./updates/updates.ts";

const PW = "password123";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PW);
});

const setup = async (opts: Parameters<typeof buildApp>[3] = {}) => {
  const db = openDb(":memory:");
  // A data dir of its own: a device folder's cover lands in <dataDir>/thumbnails.
  const dataDir = mkdtempSync(join(tmpdir(), "hub-data-"));
  onTestFinished(() => rmSync(dataDir, { recursive: true, force: true }));
  const logged: string[] = [];
  const stream = { write: (line: string) => logged.push(line) > 0 };
  const app = await buildApp(db, { stream }, dataDir, opts);
  const user = (role: "admin" | "viewer") =>
    db
      .insert(schema.users)
      .values({
        email: `${role}@x.io`,
        displayName: role,
        roleId: BUILT_IN_ROLE_IDS[role],
        passwordHash: hash,
      })
      .returning()
      .get();
  const admin = user("admin");
  const viewer = user("viewer");
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: admin.email, password: PW },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  const send = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: object,
  ) => app.inject({ method, url, payload, headers: { cookie } });
  const bearer = (token: string, url = "/api/auth/me") =>
    app.inject({ url, headers: { authorization: `Bearer ${token}` } });
  const pair = (code: string) =>
    app.inject({
      method: "POST",
      url: "/api/hub/pair",
      payload: { code, name: "Desk PC", os: "win32", connectorVersion: "5.0.0" },
    });
  return { db, app, admin, viewer, send, bearer, pair, logged };
};

describe("changing a device's user", () => {
  // A viewer's device, with one project in its folder and one in a hub root.
  const device = async () => {
    const s = await setup();
    await s.send("PATCH", "/api/preferences", { hubEnabled: true });
    const pairNew = async () => {
      const made = await s.send("POST", "/api/hub/pairing-codes", { userId: s.viewer.id });
      return (await s.pair(made.json().code)).json() as { token: string; deviceId: string };
    };
    const { token, deviceId } = await pairNew();
    const root = (location: string, name: string) =>
      s.db
        .insert(schema.roots)
        .values({ name, location, path: `/${name}`, position: 0 })
        .returning()
        .get().id;
    const project = (number: number, rootId: string) =>
      s.db
        .insert(schema.projects)
        .values({ number, name: `p${number}`, rootId, folder: "a", ownerId: s.viewer.id })
        .returning()
        .get().id;
    const onDevice = project(1, root(deviceId, "device"));
    const onHub = project(2, root("hub", "hub"));
    const ownerOf = (id: string) =>
      s.db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()?.ownerId;
    const userCode = (id: string, userId: string) =>
      s.send("POST", `/api/hub/devices/${id}/user-code`, { userId });
    const codeFor = async (userId: string, id = deviceId) =>
      (await userCode(id, userId)).json().code as string;
    const call = (path: "/check" | "", payload: object, as = token) =>
      s.app.inject({
        method: "POST",
        url: `/api/hub/device/user${path}`,
        payload,
        headers: { authorization: `Bearer ${as}` },
      });
    return { ...s, token, deviceId, onDevice, onHub, ownerOf, userCode, codeFor, call, pairNew };
  };

  it("moves the device's folder projects to the new user, and only those", async () => {
    const d = await device();
    const code = await d.codeFor(d.admin.id);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Checking tells who and how many, and doesn't use the code up. Typed any case, no dash.
    const check = await d.call("/check", { code: code.replace("-", "").toLowerCase() });
    expect(check.json()).toEqual({ userName: "admin", currentUserName: "viewer", projects: 1 });
    expect(d.ownerOf(d.onDevice)).toBe(d.viewer.id);

    const before = d.db.select().from(schema.devices).get();
    const done = await d.call("", { code, projects: "move" });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ userName: "admin", moved: 1 });
    expect(d.ownerOf(d.onDevice)).toBe(d.admin.id);
    expect(d.ownerOf(d.onHub)).toBe(d.viewer.id);

    // Same device and token; the new user's rights apply on the next request.
    expect(d.db.select().from(schema.devices).get()).toMatchObject({
      id: d.deviceId,
      name: before?.name,
      tokenHash: before?.tokenHash,
      syncMode: before?.syncMode,
      userId: d.admin.id,
    });
    expect((await d.bearer(d.token)).json().user.id).toBe(d.admin.id);
    expect((await d.bearer(d.token, "/api/hub/devices")).statusCode).toBe(200);
    // It reads its roots again: what it syncs goes by its user.
    expect(d.db.select().from(schema.hubEvents).all().at(-1)?.data).toEqual({
      type: "roots.changed",
    });

    // One use.
    expect((await d.call("", { code, projects: "move" })).statusCode).toBe(400);

    const line = d.logged.find((l) => l.includes("device user changed"));
    expect(JSON.parse(line ?? "{}")).toMatchObject({
      deviceId: d.deviceId,
      fromUserId: d.viewer.id,
      toUserId: d.admin.id,
      projects: "move",
      moved: 1,
    });
    expect(d.logged.join("\n")).not.toContain(code);
  });

  it("leaves the projects with their owner when asked", async () => {
    const d = await device();
    const done = await d.call("", { code: await d.codeFor(d.admin.id), projects: "stay" });
    expect(done.json()).toEqual({ userName: "admin", moved: 0 });
    expect(d.ownerOf(d.onDevice)).toBe(d.viewer.id);
    expect((await d.bearer(d.token)).json().user.id).toBe(d.admin.id);
  });

  it("keeps the two kinds of code apart, and a code to its own device", async () => {
    const d = await device();
    const other = await d.pairNew();
    const stay = (code: string, as?: string) => d.call("", { code, projects: "stay" }, as);

    // Another device's: refused, and it still works on its own.
    const mine = await d.codeFor(d.admin.id);
    expect((await stay(mine, other.token)).statusCode).toBe(400);
    expect((await d.call("/check", { code: mine }, other.token)).statusCode).toBe(400);
    // A user-change code never pairs a new device, and isn't used up trying.
    expect((await d.pair(mine)).statusCode).toBe(401);
    expect((await d.send("GET", "/api/hub/devices")).json()).toHaveLength(2);
    expect((await stay(mine)).statusCode).toBe(200);

    // A pairing code doesn't change a user, and still pairs.
    const made = await d.send("POST", "/api/hub/pairing-codes", { userId: d.admin.id });
    expect((await stay(made.json().code, other.token)).statusCode).toBe(400);
    expect((await d.pair(made.json().code)).statusCode).toBe(201);
  });

  it("refuses an expired, replaced or disabled target's code, and what no one should make", async () => {
    const d = await device();
    const stay = (code: string) => d.call("", { code, projects: "stay" });

    expect((await d.userCode(d.deviceId, d.viewer.id)).json().error.code).toBe("same_user");
    // Its user lists only their own machines (ADR-0021).
    expect(
      (await d.bearer(d.token, "/api/hub/devices")).json().map((x: { id: string }) => x.id),
    ).toEqual([d.deviceId]);
    expect(
      (
        await d.app.inject({
          method: "POST",
          url: `/api/hub/devices/${d.deviceId}/user-code`,
          payload: { userId: d.viewer.id },
          headers: { authorization: `Bearer ${d.token}` },
        })
      ).statusCode,
    ).toBe(403);

    const expired = await d.codeFor(d.admin.id);
    d.db
      .update(schema.pairingCodes)
      .set({ expiresAt: new Date(0).toISOString() })
      .run();
    expect((await stay(expired)).statusCode).toBe(400);

    // Only its latest code works.
    const first = await d.codeFor(d.admin.id);
    const second = await d.codeFor(d.admin.id);
    expect((await stay(first)).statusCode).toBe(400);

    // Disabled since the code was made (the user or the role): its token would be refused, which
    // would end the pairing, so the change is. The code stays for when it's enabled again.
    const { admin } = d;
    d.db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, admin.id)).run();
    expect((await stay(second)).statusCode).toBe(400);
    d.db.update(schema.users).set({ disabled: false }).where(eq(schema.users.id, admin.id)).run();
    d.db
      .update(schema.roles)
      .set({ disabled: true })
      .where(eq(schema.roles.id, BUILT_IN_ROLE_IDS.admin))
      .run();
    expect((await stay(second)).statusCode).toBe(400);
    expect(d.db.select().from(schema.devices).get()?.userId).toBe(d.viewer.id);
  });

  it("locks a device after 5 wrong codes, not the others", async () => {
    const d = await device();
    const other = await d.pairNew();
    for (let i = 0; i < 5; i++)
      expect((await d.call("/check", { code: "AAAA-AAAA" })).statusCode).toBe(400);
    const good = await d.codeFor(d.admin.id);
    expect((await d.call("/check", { code: good })).statusCode).toBe(429);
    expect((await d.call("", { code: good, projects: "stay" })).statusCode).toBe(429);
    expect((await d.call("/check", { code: "AAAA-AAAA" }, other.token)).statusCode).toBe(400);
  });

  it("revokes a device that has a live code, and the code goes with it", async () => {
    const d = await device();
    await d.codeFor(d.admin.id);
    expect((await d.send("DELETE", `/api/hub/devices/${d.deviceId}`)).statusCode).toBe(204);
    expect(d.db.select().from(schema.pairingCodes).all()).toEqual([]);
  });
});

describe("hub devices", () => {
  it("is not there while the hub is off", async () => {
    const { send, pair } = await setup();
    expect((await send("GET", "/api/hub/devices")).statusCode).toBe(404);
    expect((await pair("AAAA-AAAA")).statusCode).toBe(404);
  });

  it("pairs with a one-time code, renames, and revoking ends access at once", async () => {
    const { viewer, send, bearer, pair } = await setup();
    await send("PATCH", "/api/preferences", { hubEnabled: true });

    const made = await send("POST", "/api/hub/pairing-codes", { userId: viewer.id });
    expect(made.statusCode).toBe(201);
    const { code } = made.json();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Typed any case, without the dash.
    const paired = await pair(code.replace("-", "").toLowerCase());
    expect(paired.statusCode).toBe(201);
    const { token, deviceId } = paired.json();
    expect((await pair(code)).statusCode).toBe(401); // used

    // The device acts as its user, under that user's role.
    expect((await bearer(token)).json().user.id).toBe(viewer.id);
    expect((await bearer(token, "/api/hub/versions")).statusCode).toBe(403);
    expect((await bearer("nope")).statusCode).toBe(401);

    const [listed] = (await send("GET", "/api/hub/devices")).json();
    expect(listed).toMatchObject({
      id: deviceId,
      name: "Desk PC",
      userName: "viewer",
      os: "win32",
      connectorVersion: "5.0.0",
      syncMode: "selected", // the default for new devices
      // Online = its event stream is open; a plain request doesn't make it so.
      online: false,
      port: null,
    });
    expect(JSON.stringify(listed)).not.toContain(token);

    expect(
      (await send("PATCH", `/api/hub/devices/${deviceId}`, { name: "Laptop" })).statusCode,
    ).toBe(204);
    expect((await send("GET", "/api/hub/devices")).json()[0].name).toBe("Laptop");

    expect((await send("DELETE", `/api/hub/devices/${deviceId}`)).statusCode).toBe(204);
    expect((await bearer(token)).statusCode).toBe(401);

    // With the default off, a new device syncs everything.
    await send("PATCH", "/api/preferences", { hubDefaultSyncMode: "all" });
    await pair((await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json().code);
    const modes = (await send("GET", "/api/hub/devices"))
      .json()
      .map((d: { syncMode: string }) => d.syncMode);
    expect(modes).toContain("all");
    await send("PATCH", "/api/preferences", { hubDefaultSyncMode: "selected" });

    // Turning the hub off stops every device too, with hub_off rather than 401 (not a revoke).
    const again = await pair(
      (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json().code,
    );
    await send("PATCH", "/api/preferences", { hubEnabled: false });
    expect((await bearer(again.json().token)).statusCode).toBe(404);
  });

  it("refuses expired codes and locks an IP after 5 wrong ones", async () => {
    const { db, viewer, send, pair } = await setup();
    await send("PATCH", "/api/preferences", { hubEnabled: true });
    const { code } = (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json();
    db.update(schema.pairingCodes)
      .set({ expiresAt: new Date(0).toISOString() })
      .run();
    expect((await pair(code)).statusCode).toBe(401);

    for (let i = 0; i < 4; i++) expect((await pair("AAAA-AAAA")).statusCode).toBe(401);
    const fresh = (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json();
    expect((await pair(fresh.code)).statusCode).toBe(429);
  });

  it("behind a trusted proxy, locks the client, not everyone", async () => {
    const { app, viewer, send } = await setup({ trustProxy: ["127.0.0.1"] });
    await send("PATCH", "/api/preferences", { hubEnabled: true });
    // What the proxy forwards: whatever the client sent in X-Forwarded-For, then the client's address.
    const pairVia = (forwardedFor: string, code: string) =>
      app.inject({
        method: "POST",
        url: "/api/hub/pair",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": forwardedFor },
        payload: { code, name: "PC" },
      });
    for (let i = 0; i < 5; i++) await pairVia("203.0.113.5", "AAAA-AAAA");
    const code = async () =>
      (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json().code;
    expect((await pairVia("203.0.113.5", await code())).statusCode).toBe(429);
    // Another client pairs; naming the locked one first in the header changes nothing.
    expect((await pairVia("203.0.113.5, 198.51.100.7", await code())).statusCode).toBe(201);
  });
});

describe("hub events", () => {
  let close: (() => Promise<unknown>) | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await close?.();
  });

  // A listening hub with one viewer device; `open` holds GET /api/hub/events like the connector.
  const live = async (opts: Parameters<typeof buildApp>[3] = {}) => {
    const s = await setup(opts);
    close = () => s.app.close();
    await s.send("PATCH", "/api/preferences", { hubEnabled: true });
    const { code } = (
      await s.send("POST", "/api/hub/pairing-codes", { userId: s.viewer.id })
    ).json();
    const { token, deviceId } = (await s.pair(code)).json();
    const base = await s.app.listen({ port: 0, host: "127.0.0.1" });
    const open = async (headers: Record<string, string> = {}) => {
      const res = await fetch(`${base}/api/hub/events`, {
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      let text = "";
      /** Reads until `text` contains `what` (or passes it); null once the hub ended the stream. */
      const until = async (what: string | ((text: string) => boolean)) => {
        while (typeof what === "string" ? !text.includes(what) : !what(text)) {
          const { done, value } = await reader.read();
          if (done) return null;
          text += dec.decode(value, { stream: true });
        }
        return text;
      };
      return { res, until, cancel: () => reader.cancel() };
    };
    return { ...s, token, deviceId, open };
  };

  it("is for devices only and records the connector's version", async () => {
    const { send, open, deviceId } = await live();
    expect((await send("GET", "/api/hub/events")).statusCode).toBe(403);
    const s = await open({
      "x-connector-version": "5.0.1",
      "x-connector-os": "linux x64",
      "x-connector-port": "4305",
    });
    expect(s.res.headers.get("content-type")).toBe("text/event-stream");
    expect(s.res.headers.get("x-accel-buffering")).toBe("no");
    await s.until(": open");
    const [d] = (await send("GET", "/api/hub/devices")).json();
    expect(d).toMatchObject({
      id: deviceId,
      connectorVersion: "5.0.1",
      os: "linux x64",
      online: true,
      // Its local page, for the machine page's link there.
      port: 4305,
    });
    await s.cancel();
  });

  it("marks an outdated connector, alerts admins, and Update now reaches it", async () => {
    const { send, open, deviceId } = await live();
    const update = () => send("POST", `/api/hub/devices/${deviceId}/update`);
    const alert = async () =>
      (await send("GET", "/api/alerts"))
        .json()
        .find((a: { kind: string }) => a.kind === "connector_outdated");
    expect((await update()).statusCode).toBe(409); // offline

    const failure = { version: VERSION, reason: "download", error: "HTTP 404" };
    const s = await open({
      "x-connector-version": "0.0.1",
      "x-connector-update": JSON.stringify(failure),
    });
    await s.until(": open");
    expect((await send("GET", "/api/hub/devices")).json()[0]).toMatchObject({
      outdated: true,
      updateFailed: failure,
    });
    await vi.waitFor(async () =>
      expect(await alert()).toMatchObject({ severity: "error", module: "hub", entityId: deviceId }),
    );
    expect((await update()).statusCode).toBe(204);
    expect(await s.until("event: connector.update")).toBeTruthy();
    await s.cancel();

    // Back on the hub's version: not outdated, and the alert resolves.
    const t = await open({ "x-connector-version": VERSION });
    await t.until(": open");
    expect((await send("GET", "/api/hub/devices")).json()[0]).toMatchObject({
      outdated: false,
      updateFailed: null,
    });
    await vi.waitFor(async () => expect(await alert()).toBeUndefined());
    await t.cancel();
  });

  it("pushes events live, replays missed ones and deletes acked ones", async () => {
    const { db, send, open, deviceId } = await live();
    const rename = (name: string) => send("PATCH", `/api/hub/devices/${deviceId}`, { name });
    const a = await open();
    await a.until(": open");
    await rename("One");
    const text = await a.until('"One"');
    expect(text).toContain(`event: device.renamed\ndata: {"type":"device.renamed","name":"One"}`);
    const first = Number(/^id: (\d+)$/m.exec(text ?? "")?.[1]);
    await a.cancel();

    await rename("Two"); // while disconnected
    const b = await open({ "last-event-id": String(first) });
    const replay = await b.until('"Two"');
    expect(replay).not.toContain('"One"');
    expect(
      db
        .select()
        .from(schema.hubEvents)
        .all()
        .map((e) => e.data),
    ).toEqual([{ type: "device.renamed", name: "Two" }]);
    await b.cancel();
  });

  it("ends the stream on revoke", async () => {
    const { send, open, deviceId } = await live();
    const s = await open();
    await s.until(": open");
    await send("DELETE", `/api/hub/devices/${deviceId}`);
    expect(await s.until("never")).toBeNull();
  });

  it("beats every 15 s and ends once the user is disabled", async () => {
    const { db, open, viewer } = await live();
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const s = await open();
    await s.until(": open");
    vi.advanceTimersByTime(15_000);
    await s.until(": hb");
    db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, viewer.id)).run();
    vi.advanceTimersByTime(15_000);
    expect(await s.until("never")).toBeNull();
  });

  it("tells the device its user's name on connect and when it changes, encoded and not stored", async () => {
    const { db, open, viewer } = await live();
    db.update(schema.users).set({ displayName: "Zoë" }).where(eq(schema.users.id, viewer.id)).run();
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const s = await open();
    await s.until(": open");
    expect(s.res.headers.get("x-device-user")).toBe("Zo%C3%AB");

    // Nothing to tell yet.
    vi.advanceTimersByTime(15_000);
    expect(await s.until(": hb")).not.toContain("device.user");

    db.update(schema.users).set({ displayName: "Zoe" }).where(eq(schema.users.id, viewer.id)).run();
    vi.advanceTimersByTime(15_000);
    expect(await s.until('"Zoe"')).toContain(
      `event: device.user\ndata: {"type":"device.user","name":"Zoe"}`,
    );
    expect(db.select().from(schema.hubEvents).all()).toEqual([]);
    await s.cancel();
  });

  it("takes a device root's index and folders like a scan, and tells offline from missing", async () => {
    const { db, app, send, open, token, deviceId } = await live();
    const dev = (method: "GET" | "PUT" | "DELETE", url: string, payload?: object) =>
      app.inject({
        method,
        url: `/api/hub/device${url}`,
        payload,
        headers: { authorization: `Bearer ${token}` },
      });
    const root = (location: string) =>
      db
        .insert(schema.roots)
        .values({ name: "WS", location, path: "C:/models", position: 0 })
        .returning()
        .get();
    const mine = root(deviceId);
    const theirs = root("6f1c3f5e-7d4c-4c1e-9b1a-1a2b3c4d5e6f");
    const folder = (digest: string) => ({
      rel: "001_Box",
      digest,
      scan: {
        files: [
          { path: "box.stl", kind: "model", size: 5, mtime: 1 },
          { path: "README.md", kind: "doc", size: 9, mtime: 1 },
        ],
        models: [],
        mainFile: "box.stl",
        sourceUrl: null,
        hasModel: true,
        unreadable: 0,
      },
      texts: { "README.md": "A box." },
      cover: { ext: ".png", data: Buffer.from("png").toString("base64"), file: null },
      previews: [],
      gallery: [],
      galleryLeftOut: [],
    });
    const index = (digest: string) =>
      dev("PUT", `/roots/${mine.id}/index`, { state: "ok", folders: [{ rel: "001_Box", digest }] });
    const detail = async () => {
      const [p] = (await send("GET", "/api/projects")).json().items;
      return p && (await send("GET", `/api/projects/${p.id}`)).json();
    };

    const s = await open();
    await s.until(": open");
    expect((await dev("GET", "/roots")).json()).toEqual([
      {
        id: mine.id,
        path: mine.path,
        projectDepth: 1,
        filesDepth: null,
        maxFiles: expect.any(Number),
        folderMaxMb: 32,
        covers: {},
        galleries: {},
        projects: 0,
      },
    ]);
    expect((await index("a")).json()).toEqual({ want: ["001_Box"] });
    expect((await dev("PUT", `/roots/${mine.id}/folders`, folder("a"))).statusCode).toBe(204);
    expect(await detail()).toMatchObject({
      name: "Box",
      number: 1,
      filePath: "box.stl",
      folderState: "ok",
      thumbnailPath: expect.stringMatching(/\.png$/),
    });
    expect((await index("a")).json()).toEqual({ want: [] });
    expect((await index("b")).json()).toEqual({ want: ["001_Box"] });

    // Linking a doc reads the text the device sent.
    const { id } = await detail();
    await send("PATCH", `/api/projects/${id}`, { descriptionFile: "README.md" });
    expect((await detail()).description).toBe("A box.");

    // Not in the device's shared folders: last known data, like offline; nothing is forgotten.
    const mineNow = async () =>
      (await send("GET", "/api/roots")).json().find((r: { id: string }) => r.id === mine.id);
    expect((await dev("PUT", `/roots/${mine.id}/index`, { state: "unshared" })).json()).toEqual({
      want: [],
    });
    expect(await detail()).toMatchObject({ folderState: "offline", description: "A box." });
    expect((await send("GET", "/api/projects")).json().items[0].offline).toBe(true);
    expect(await mineNow()).toMatchObject({ state: "unshared" });
    expect((await dev("GET", "/roots")).json()[0].projects).toBe(1);
    expect((await index("a")).json()).toEqual({ want: [] });
    expect(await mineNow()).toMatchObject({ state: "ok" });
    expect((await detail()).folderState).toBe("ok");

    // Only its own roots; paths stay inside the root.
    expect((await dev("PUT", `/roots/${theirs.id}/index`, { state: "missing" })).statusCode).toBe(
      404,
    );
    expect(
      (await dev("PUT", `/roots/${mine.id}/folders`, { ...folder("c"), rel: "../x" })).statusCode,
    ).toBe(400);
    expect((await send("GET", "/api/hub/device/roots")).statusCode).toBe(403);

    // The size setting: over it 413, and a change makes the device read its roots and resend.
    const big = { ...folder("a"), texts: { "README.md": "x".repeat(60_000) } };
    expect((await send("PATCH", "/api/preferences", { deviceFolderMaxMb: 1 })).statusCode).toBe(
      200,
    );
    expect(
      (
        await dev("PUT", `/roots/${mine.id}/folders`, {
          ...big,
          previews: [
            { file: "box.stl", entry: "t.png", data: Buffer.alloc(900_000).toString("base64") },
            { file: "box.stl", entry: "u.png", data: Buffer.alloc(900_000).toString("base64") },
          ],
        })
      ).statusCode,
    ).toBe(413);
    expect((await s.until((t) => t.includes('"roots.changed"'))) ?? "").toContain("roots.changed");
    expect((await index("a")).json()).toEqual({ want: ["001_Box"] });
    await send("PATCH", "/api/preferences", { deviceFolderMaxMb: 32 });

    expect((await dev("DELETE", `/roots/${mine.id}/folders?rel=001_Box`)).statusCode).toBe(204);
    expect((await detail()).folderState).toBe("missing");
    await dev("PUT", `/roots/${mine.id}/index`, { state: "missing" });
    expect(
      (await send("GET", "/api/roots")).json().find((r: { id: string }) => r.id === mine.id),
    ).toMatchObject({ state: "missing", deviceName: "Desk PC" });

    // The stream ends: offline, with the last known data.
    await s.cancel();
    for (let i = 0; i < 100 && (await detail()).folderState !== "offline"; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(await detail()).toMatchObject({ folderState: "offline", name: "Box" });
    expect((await send("GET", "/api/projects")).json().items[0].offline).toBe(true);
    const add = await send("POST", "/api/roots", { path: "D:/more", location: deviceId });
    expect(add.json().error.code).toBe("device_offline");
  });

  it("tells a connector too old for a request from one that doesn't answer", async () => {
    const { app, send, open, token, deviceId } = await live();
    const s = await open();
    await s.until(": open");
    const listing = send("GET", `/api/fs/list?device=${deviceId}`);
    const text = (await s.until((t) => t.includes('"fs.list"'))) ?? "";
    const requestId = /"requestId":"([^"]+)"/.exec(text)?.[1];
    // What a connector answers for a request type it doesn't know.
    await app.inject({
      method: "POST",
      url: `/api/hub/device/replies/${requestId}`,
      payload: { ok: false, code: "ENOTSUP" },
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await listing;
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("device_outdated");
    await s.cancel();
  });

  it("Send presets and Install per slicer: offline on the next connect, online asked (ADR-0020)", async () => {
    const { app, send, open, token, deviceId, db } = await live({
      adapters: adapters({ mock: false }),
    });
    const url = (lib: string) => `/api/hub/devices/${deviceId}/slicers/${lib}`;
    const on = { user: { share: true } };
    expect((await send("PATCH", url("nope"), on)).statusCode).toBe(404);
    // Offline: stored, and told when it connects.
    expect((await send("PATCH", url("bambu-studio"), on)).statusCode).toBe(204);
    const s = await open();
    await s.until(": open");
    expect(JSON.parse(s.res.headers.get("x-preset-libraries") ?? "")).toEqual({
      "bambu-studio": { send: true, install: false },
    });
    // What a connector before per-slicer switches reads.
    expect(s.res.headers.get("x-share-presets")).toBe("1");
    expect(s.res.headers.get("x-install-presets")).toBe("0");

    // Online: asked first; one that doesn't know the request keeps its values.
    const patch = send("PATCH", url("orca-slicer"), { user: { receive: true } });
    const text = (await s.until((t) => t.includes('"presets.set"'))) ?? "";
    const requestId = /"requestId":"([^"]+)"/.exec(text)?.[1];
    await app.inject({
      method: "POST",
      url: `/api/hub/device/replies/${requestId}`,
      payload: { ok: false, code: "ENOTSUP" },
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await patch;
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("device_outdated");
    const empty = emptyPresetLibrary();
    expect(db.select().from(schema.devices).get()?.presetLibraries).toEqual({
      "bambu-studio": { ...empty, user: { ...empty.user, share: true } },
    });
    await s.cancel();
  });

  it("shows a machine's page to its own user, who edits only the sections they may (ADR-0021)", async () => {
    const { app, db, send, viewer, deviceId } = await live({ adapters: adapters({ mock: false }) });
    // Another machine, paired to the admin.
    const { code } = (
      await send("POST", "/api/hub/pairing-codes", {
        userId: (await send("GET", "/api/auth/me")).json().user.id,
      })
    ).json();
    const theirs = (
      await app.inject({
        method: "POST",
        url: "/api/hub/pair",
        payload: { code, name: "Admin PC", os: "win32", connectorVersion: "5.0.0" },
      })
    ).json().deviceId;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: viewer.email, password: PW },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    const mine = (method: "GET" | "PATCH" | "POST" | "DELETE", url: string, payload?: object) =>
      app.inject({ method, url, payload, headers: { cookie } });
    const grant = (permissions: Record<string, unknown>) =>
      db.update(schema.users).set({ permissions }).where(eq(schema.users.id, viewer.id)).run();
    const lib = `/api/hub/devices/${deviceId}/slicers/bambu-studio`;

    expect((await mine("GET", "/api/hub/devices")).json().map((d: { id: string }) => d.id)).toEqual(
      [deviceId],
    );
    // Another's machine is unknown; its own is read-only without a switch.
    expect(
      (
        await mine("PATCH", `/api/hub/devices/${theirs}/slicers/bambu-studio`, {
          user: { share: true },
        })
      ).statusCode,
    ).toBe(404);
    expect((await mine("PATCH", lib, { user: { share: true } })).statusCode).toBe(403);
    expect((await mine("PATCH", lib, { system: { receive: true } })).statusCode).toBe(403);
    // The switch alone isn't enough: System and User presets also need catalog write (ADR-0023).
    grant({ "machine.catalog": true });
    expect((await mine("PATCH", lib, { user: { share: true } })).statusCode).toBe(403);
    grant({ "machine.catalog": true, catalog: "write" });
    expect((await mine("PATCH", lib, { user: { share: true } })).statusCode).toBe(204);
    expect(
      db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get()
        ?.presetLibraries["bambu-studio"]?.user.share,
    ).toBe(true);
    // Renaming, Restart, Revoke and Update now aren't sections it has.
    expect((await mine("PATCH", `/api/hub/devices/${deviceId}`, { name: "Mine" })).statusCode).toBe(
      403,
    );
    expect((await mine("POST", `/api/hub/devices/${deviceId}/restart`)).statusCode).toBe(403);
    expect((await mine("DELETE", `/api/hub/devices/${deviceId}`)).statusCode).toBe(403);
    expect((await mine("POST", `/api/hub/devices/${deviceId}/update`)).statusCode).toBe(403);
    grant({ "machine.projects": true });
    expect(
      (await mine("PATCH", `/api/hub/devices/${deviceId}`, { receiveProjects: false })).statusCode,
    ).toBe(403);
    grant({ "machine.projects": true, projects: "write" });
    expect(
      (await mine("PATCH", `/api/hub/devices/${deviceId}`, { receiveProjects: false })).statusCode,
    ).toBe(204);
  });

  it("Use as slicer offers it; the picked hub's slicer stays offered and receives no catalog", async () => {
    const { db, send, deviceId } = await live({ adapters: adapters({ mock: false }) });
    const lib = `/api/hub/devices/${deviceId}/slicers/bambu-studio`;
    expect(
      (await send("PATCH", `/api/hub/devices/${deviceId}/slicers/nope`, { slicer: true }))
        .statusCode,
    ).toBe(404);
    const saved = () =>
      db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get()
        ?.presetLibraries["bambu-studio"];
    // Consent can come before the install (ADR-0022).
    expect((await send("PATCH", lib, { slicer: true })).statusCode).toBe(204);
    expect(saved()?.slicer).toBe(true);

    const worker = db
      .insert(schema.integrations)
      .values({ adapterId: "bambu-studio-worker", config: { deviceId, source: "installed" } })
      .returning()
      .get();
    const listed = async () =>
      (await send("GET", "/api/hub/devices")).json()[0].libraries["bambu-studio"];
    // The only install that's offered: the hub's slicer by default, which receives no catalog.
    expect((await listed()).hubSlicer).toBe(true);
    expect((await send("PATCH", lib, { system: { receive: true } })).json().error.code).toBe(
      "hub_slicer",
    );
    // A default one can be withdrawn: the default moves on.
    expect((await send("PATCH", lib, { slicer: false })).statusCode).toBe(204);
    expect((await listed()).hubSlicer).toBe(false);
    expect((await send("PATCH", lib, { slicer: true })).statusCode).toBe(204);

    // Picked, it stays offered until another is picked.
    const pick = (integrationId: string) =>
      send("PUT", "/api/integrations/slicers/bambu-studio", { integrationId });
    expect((await pick(worker.id)).statusCode).toBe(204);
    expect((await send("PATCH", lib, { slicer: false })).json().error.code).toBe("hub_slicer");
    expect(saved()).toMatchObject({ slicer: true, system: { receive: false } });
    expect((await pick(crypto.randomUUID())).json().error.code).toBe("not_an_option");
  });

  it("refuses a second install of a slicer on the same machine", async () => {
    const { send, deviceId } = await live({ adapters: adapters({ mock: false }) });
    const add = (adapterId: string, config?: object) =>
      send("POST", "/api/integrations", { adapterId, config });
    const worker = { deviceId, source: "managed" };
    expect((await add("bambu-studio-worker", worker)).statusCode).toBe(201);
    expect((await add("bambu-studio-worker", worker)).json().error.code).toBe("slicer_exists");
    // This server is one machine: installed or downloaded, not both.
    expect((await add("bambu-studio-server")).statusCode).toBe(201);
    expect((await add("bambu-studio")).json().error.code).toBe("slicer_exists");
    // Nor by moving a worker to a machine that has it (ADR-0022).
    const other = await add("bambu-studio-worker", {
      deviceId: crypto.randomUUID(),
      source: "managed",
    });
    expect(other.statusCode).toBe(201);
    const move = (config: object) =>
      send("PATCH", `/api/integrations/${other.json().id}`, { config });
    expect((await move(worker)).json().error.code).toBe("slicer_exists");
    expect((await move({ deviceId: crypto.randomUUID(), source: "installed" })).statusCode).toBe(
      200,
    );
  });

  it("Stop, the default slicer and Share reach the connector; an older one is outdated", async () => {
    const { app, db, send, open, token, deviceId, bearer } = await live();
    const url = `/api/hub/devices/${deviceId}`;
    const s = await open();
    await s.until(": open");
    expect(s.res.headers.get("x-share-projects")).toBe("1");
    let seen = 0;
    const answer = async (type: string, body: unknown) => {
      const ids = (t: string) => [...t.matchAll(/"requestId":"([^"]+)"/g)];
      const text = (await s.until((t) => ids(t).length > seen)) ?? "";
      const requestId = ids(text)[seen++]?.[1];
      expect(text).toContain(`"${type}"`);
      await app.inject({
        method: "POST",
        url: `/api/hub/device/replies/${requestId}`,
        payload: body as object,
        headers: { authorization: `Bearer ${token}` },
      });
    };
    const old = { ok: false, code: "ENOTSUP" };
    const code = async (res: Promise<{ json: () => { error: { code: string } } }>) =>
      (await res).json().error.code;

    const stopOld = send("POST", `${url}/stop`);
    await answer("connector.stop", old);
    expect(await code(stopOld)).toBe("device_outdated");
    const stop = send("POST", `${url}/stop`);
    await answer("connector.stop", { ok: true, result: null });
    expect((await stop).statusCode).toBe(204);

    // An older connector drops `defaultSlicer` and answers ok.
    const slicerOld = send("PUT", `${url}/settings`, { defaultSlicer: "" });
    await answer("connector.settings.set", {
      ok: true,
      result: { port: 4301, autostart: true, restartRequired: false },
    });
    expect(await code(slicerOld)).toBe("device_outdated");
    const slicer = send("PUT", `${url}/settings`, { defaultSlicer: "" });
    await answer("connector.settings.set", {
      ok: true,
      result: { port: 4301, autostart: true, defaultSlicer: "", restartRequired: false },
    });
    expect((await slicer).json()).toMatchObject({ defaultSlicer: "" });

    const shared = () => db.select().from(schema.devices).get()?.shareProjects;
    const shareOld = send("PATCH", url, { shareProjects: false });
    await answer("projects.share", old);
    expect(await code(shareOld)).toBe("device_outdated");
    expect(shared()).toBe(true);
    const share = send("PATCH", url, { shareProjects: false });
    await answer("projects.share", { ok: true, result: null });
    expect((await share).statusCode).toBe(204);
    expect(shared()).toBe(false);

    // Receive off: it syncs as selected with nothing selected.
    expect((await send("PATCH", url, { receiveProjects: false })).statusCode).toBe(204);
    expect((await bearer(token, "/api/hub/device/sync/roots")).json().mode).toBe("selected");
    await s.cancel();
  });

  it("edits a connector's settings and restarts it with live requests, never queued", async () => {
    const { app, send, open, token, deviceId } = await live();
    const url = `/api/hub/devices/${deviceId}`;
    for (const [method, path, payload] of [
      ["GET", "/settings"],
      ["PUT", "/settings", { port: 4400 }],
      ["POST", "/restart"],
    ] as const) {
      const res = await send(method, url + path, payload);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("device_offline");
    }
    expect((await send("PUT", `${url}/settings`, { port: 80 })).statusCode).toBe(400);
    expect((await send("GET", `/api/hub/devices/${crypto.randomUUID()}/settings`)).statusCode).toBe(
      404,
    );

    const s = await open();
    await s.until(": open");
    let seen = 0;
    const answer = async (type: string, body: unknown) => {
      // Requests pile up in the stream's text: wait for one beyond those answered already.
      const ids = (t: string) => [...t.matchAll(/"requestId":"([^"]+)"/g)];
      const text = (await s.until((t) => ids(t).length > seen)) ?? "";
      const requestId = ids(text)[seen++]?.[1];
      expect(text).toContain(`"${type}"`);
      await app.inject({
        method: "POST",
        url: `/api/hub/device/replies/${requestId}`,
        payload: body as object,
        headers: { authorization: `Bearer ${token}` },
      });
    };
    const got = send("GET", `${url}/settings`);
    await answer("connector.settings.get", { ok: true, result: { port: 4301, autostart: true } });
    expect((await got).json()).toEqual({ port: 4301, autostart: true });

    const set = send("PUT", `${url}/settings`, { port: 4400, autostart: false });
    await answer("connector.settings.set", {
      ok: true,
      result: { port: 4400, autostart: false, restartRequired: true },
    });
    expect((await set).json()).toMatchObject({ port: 4400, restartRequired: true });

    const restart = send("POST", `${url}/restart`);
    await answer("connector.restart", { ok: true, result: null });
    expect((await restart).statusCode).toBe(204);

    const failing = send("POST", `${url}/restart`);
    await answer("connector.restart", { ok: false, code: "EIO" });
    expect((await failing).statusCode).toBe(502);
    await s.cancel();
  });

  it("pulls a listed file from its device and keeps it only when its hash matches", async () => {
    const { db, app, send, open, token, deviceId } = await live();
    const root = db
      .insert(schema.roots)
      .values({ name: "WS", location: deviceId, path: "C:/models", position: 0 })
      .returning()
      .get();
    const dev = (method: "PUT", url: string, payload: object | Buffer, headers = {}) =>
      app.inject({
        method,
        url: `/api/hub/device${url}`,
        payload,
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
    const s = await open();
    await s.until(": open");
    const file = { path: "box.stl", kind: "model", size: 5, mtime: 1_700_000_000_123 };
    await dev("PUT", `/roots/${root.id}/folders`, {
      rel: "001_Box",
      digest: "a",
      scan: {
        files: [file],
        models: [],
        mainFile: "box.stl",
        sourceUrl: null,
        hasModel: true,
        unreadable: 0,
      },
      texts: {},
      cover: null,
      previews: [],
      gallery: [],
      galleryLeftOut: [],
    });
    const [{ id }] = (await send("GET", "/api/projects")).json().items;
    const get = () => send("GET", `/api/projects/${id}/file?path=box.stl`);
    const uploads = (text: string) =>
      [...text.matchAll(/"type":"fs\.upload","requestId":"([^"]+)"/g)].map((m) => m[1] ?? "");
    let seen = 0;
    /** The next `fs.upload` request the device gets. */
    const asked = async () =>
      uploads((await s.until((t) => uploads(t).length > seen)) ?? "")[seen++] ?? "";
    const sha = (data: string) => createHash("sha256").update(data).digest("hex");
    const upload = (requestId: string, data: string, hash = sha(data)) =>
      dev("PUT", `/files/${requestId}`, Buffer.from(data), {
        "content-type": "application/octet-stream",
        "x-file-sha256": hash,
        "x-file-mtime": String(file.mtime),
      });

    // Damaged on the way: refused, and the download fails.
    let pending = get();
    let requestId = await asked();
    expect((await upload(requestId, "hello", sha("other"))).statusCode).toBe(502);
    expect((await pending).json().error.code).toBe("device_bad_file");
    // Nothing waits for it any more.
    expect((await upload(requestId, "hello")).statusCode).toBe(404);

    pending = get();
    requestId = await asked();
    expect((await upload(requestId, "hello")).statusCode).toBe(204);
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("hello");
    // Cached: no second pull.
    expect((await get()).body).toBe("hello");
    expect(seen).toBe(2);
    await s.cancel();
  });
});
