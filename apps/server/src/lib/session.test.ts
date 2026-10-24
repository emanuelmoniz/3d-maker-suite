import { type Db, openDb, schema } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  endUserSessions,
  pruneSessions,
  readCookie,
  readSession,
  sessionCookie,
} from "./session.ts";

const { sessions, users } = schema;
const DAY = 86_400_000;
const t0 = new Date("2026-10-01T00:00:00.000Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

let db: Db;
let userId: string;
beforeEach(() => {
  db = openDb(":memory:");
  userId = db
    .insert(users)
    .values({ email: "a@b.c", displayName: "A", passwordHash: "x", role: "admin" })
    .returning()
    .get().id;
});

describe("sessions", () => {
  it("stores only the token's hash and reads the user back without the hash", () => {
    const { token, expiresAt } = createSession(db, userId, t0);
    expect(expiresAt).toBe(at(30).toISOString());
    expect(db.select().from(sessions).get()?.id).not.toBe(token);
    const s = readSession(db, token, at(1));
    expect(s).toMatchObject({ user: { id: userId }, expiresAt, refreshed: false });
    expect(s?.user).not.toHaveProperty("passwordHash");
    expect(readSession(db, "nope", at(1))).toBeNull();
  });

  it("slides the expiry in the last half of the window", () => {
    const { token } = createSession(db, userId, t0);
    const s = readSession(db, token, at(16));
    expect(s).toMatchObject({ refreshed: true, expiresAt: at(46).toISOString() });
    expect(readSession(db, token, at(45))).not.toBeNull();
  });

  it("deletes an expired session when it's read", () => {
    const { token } = createSession(db, userId, t0);
    expect(readSession(db, token, at(30))).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("ignores disabled users", () => {
    const { token } = createSession(db, userId, t0);
    db.update(users).set({ disabled: true }).run();
    expect(readSession(db, token, at(1))).toBeNull();
  });

  it("logs out one session, all of a user's, and prunes expired ones", () => {
    const a = createSession(db, userId, t0);
    createSession(db, userId, at(10));
    deleteSession(db, a.token);
    expect(db.select().from(sessions).all()).toHaveLength(1);
    createSession(db, userId, t0);
    pruneSessions(db, at(30));
    expect(db.select().from(sessions).all()).toHaveLength(1);
    endUserSessions(db, userId);
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("goes when the user is deleted", () => {
    createSession(db, userId, t0);
    db.insert(schema.userSettings).values({ userId, key: "language", value: "en" }).run();
    db.delete(users).run();
    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect(db.select().from(schema.userSettings).all()).toHaveLength(0);
  });
});

describe("cookies", () => {
  it("reads one cookie from the header", () => {
    expect(readCookie("a=1; session=abc%3D; b=2", "session")).toBe("abc=");
    expect(readCookie("xsession=1;session=2", "session")).toBe("2");
    expect(readCookie("a=1", "session")).toBeUndefined();
    expect(readCookie(undefined, "session")).toBeUndefined();
    expect(readCookie("session=%E0", "session")).toBeUndefined();
  });

  it("builds the Set-Cookie value", () => {
    const c = sessionCookie("tok", at(30).toISOString(), false);
    expect(c).toBe(
      "session=tok; Expires=Sat, 31 Oct 2026 00:00:00 GMT; HttpOnly; SameSite=Lax; Path=/",
    );
    expect(sessionCookie("tok", at(30).toISOString(), true)).toBe(`${c}; Secure`);
    expect(clearSessionCookie(false)).toContain("session=; Expires=Thu, 01 Jan 1970");
  });
});
