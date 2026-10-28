import { openDb, schema } from "@3d-maker-suite/db";
import { beforeAll, describe, expect, it } from "vitest";
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

    // Turning the hub off stops every device too.
    const again = await pair(
      (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json().code,
    );
    await send("PATCH", "/api/preferences", { hubEnabled: false });
    expect((await bearer(again.json().token)).statusCode).toBe(401);
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
