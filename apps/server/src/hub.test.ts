import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { buildApp } from "./app.ts";
import { hashPassword } from "./lib/password.ts";

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
  const app = await buildApp(db, { stream: { write: () => true } }, dataDir, opts);
  const user = (role: "admin" | "viewer") =>
    db
      .insert(schema.users)
      .values({ email: `${role}@x.io`, displayName: role, role, passwordHash: hash })
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
  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });
  const bearer = (token: string, url = "/api/auth/me") =>
    app.inject({ url, headers: { authorization: `Bearer ${token}` } });
  const pair = (code: string) =>
    app.inject({
      method: "POST",
      url: "/api/hub/pair",
      payload: { code, name: "Desk PC", os: "win32", connectorVersion: "5.0.0" },
    });
  return { db, app, admin, viewer, send, bearer, pair };
};

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
    expect((await bearer(token, "/api/hub/devices")).statusCode).toBe(403);
    expect((await bearer("nope")).statusCode).toBe(401);

    const [listed] = (await send("GET", "/api/hub/devices")).json();
    expect(listed).toMatchObject({
      id: deviceId,
      name: "Desk PC",
      userName: "viewer",
      os: "win32",
      connectorVersion: "5.0.0",
      // Online = its event stream is open; a plain request doesn't make it so.
      online: false,
    });
    expect(JSON.stringify(listed)).not.toContain(token);

    expect(
      (await send("PATCH", `/api/hub/devices/${deviceId}`, { name: "Laptop" })).statusCode,
    ).toBe(204);
    expect((await send("GET", "/api/hub/devices")).json()[0].name).toBe("Laptop");

    expect((await send("DELETE", `/api/hub/devices/${deviceId}`)).statusCode).toBe(204);
    expect((await bearer(token)).statusCode).toBe(401);

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
  const live = async () => {
    const s = await setup();
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
    const s = await open({ "x-connector-version": "5.0.1", "x-connector-os": "linux x64" });
    expect(s.res.headers.get("content-type")).toBe("text/event-stream");
    expect(s.res.headers.get("x-accel-buffering")).toBe("no");
    await s.until(": open");
    const [d] = (await send("GET", "/api/hub/devices")).json();
    expect(d).toMatchObject({
      id: deviceId,
      connectorVersion: "5.0.1",
      os: "linux x64",
      online: true,
    });
    await s.cancel();
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
