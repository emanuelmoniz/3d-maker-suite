import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.ts";
import { hashPassword } from "./lib/password.ts";

const PW = "password123";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PW);
});

const setup = async () => {
  const db = openDb(":memory:");
  const app = await buildApp(db, { stream: { write: () => true } }, "", {});
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
      online: true,
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
      /** Reads until `text` contains `what`; null once the hub ended the stream. */
      const until = async (what: string) => {
        while (!text.includes(what)) {
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
    expect(d).toMatchObject({ id: deviceId, connectorVersion: "5.0.1", os: "linux x64" });
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
});
