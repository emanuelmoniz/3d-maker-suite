import { createHash, randomBytes } from "node:crypto";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, lte } from "drizzle-orm";

const { sessions, users } = schema;

// ADR-0012: a random token in an HttpOnly cookie, only its sha256 in `sessions`. 30-day sliding
// expiry: a request in the last half of the window extends it.
export const SESSION_COOKIE = "session";
const TTL_MS = 30 * 86_400_000;

const hash = (token: string) => createHash("sha256").update(token).digest("base64url");
const expiry = (now: Date) => new Date(now.getTime() + TTL_MS).toISOString();

export function createSession(db: Db, userId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = expiry(now);
  db.insert(sessions)
    .values({ id: hash(token), userId, expiresAt })
    .run();
  return { token, expiresAt };
}

/**
 * The enabled user behind a token, or null. An expired row is deleted on the spot; one in the
 * last half of its window is extended, and `refreshed` says the cookie needs sending again.
 */
export function readSession(db: Db, token: string, now = new Date()) {
  const id = hash(token);
  const row = db
    .select({ expiresAt: sessions.expiresAt, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  const left = Date.parse(row.expiresAt) - now.getTime();
  if (left <= 0) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  if (row.user.disabled) return null;
  const refreshed = left < TTL_MS / 2;
  const expiresAt = refreshed ? expiry(now) : row.expiresAt;
  if (refreshed) db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id)).run();
  const { passwordHash: _, ...user } = row.user;
  return { user, expiresAt, refreshed };
}

export const deleteSession = (db: Db, token: string) =>
  db
    .delete(sessions)
    .where(eq(sessions.id, hash(token)))
    .run();

/** Logs a user out everywhere (disabled, role changed, password reset). */
export const endUserSessions = (db: Db, userId: string) =>
  db.delete(sessions).where(eq(sessions.userId, userId)).run();

/** Hourly, with the log pruning. */
export const pruneSessions = (db: Db, now = new Date()) =>
  db.delete(sessions).where(lte(sessions.expiresAt, now.toISOString())).run();

/** One cookie's value from a `Cookie` header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** `Set-Cookie` for the session. `secure` when the request came over HTTPS (directly or via a proxy). */
export const sessionCookie = (token: string, expiresAt: string, secure: boolean) =>
  `${SESSION_COOKIE}=${token}; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}`;

export const clearSessionCookie = (secure: boolean) =>
  sessionCookie("", new Date(0).toISOString(), secure);
