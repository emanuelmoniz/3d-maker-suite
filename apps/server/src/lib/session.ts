import { createHash, randomBytes } from "node:crypto";
import { effectiveAlertKinds, effectiveRights } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, lte } from "drizzle-orm";

const { roles, sessions, users } = schema;

// ADR-0012: a random token in an HttpOnly cookie, only its sha256 in `sessions`. 30-day sliding
// expiry: a request in the last half of the window extends it.
export const SESSION_COOKIE = "session";
const TTL_MS = 30 * 86_400_000;

/** How `sessions` and `devices` store a token (ADR-0012). */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("base64url");
const expiry = (now: Date) => new Date(now.getTime() + TTL_MS).toISOString();

export function createSession(db: Db, userId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = expiry(now);
  db.insert(sessions)
    .values({ id: tokenHash(token), userId, expiresAt })
    .run();
  return { token, expiresAt };
}

type UserRow = typeof users.$inferSelect;
type RoleRow = typeof roles.$inferSelect;

/**
 * The user as a request carries it: no hash, with the role's name, the effective rights and alert
 * subscriptions (ADR-0016), read per request so a role or override change applies on the next one.
 */
export function sessionUser({ passwordHash: _, ...user }: UserRow, role: RoleRow) {
  return {
    ...user,
    role: { id: role.id, name: role.name, builtIn: role.builtIn, alertKinds: role.alertKinds },
    rights: effectiveRights(role, user),
    subscriptions: effectiveAlertKinds(role, user),
  };
}
export type SessionUser = ReturnType<typeof sessionUser>;

/** A disabled role counts like a disabled user (ADR-0016). */
export const isEnabled = (row: { user: UserRow; role: RoleRow }) =>
  !row.user.disabled && !row.role.disabled;

/**
 * The enabled user behind a token, or null. An expired row is deleted on the spot; one in the
 * last half of its window is extended, and `refreshed` says the cookie needs sending again.
 */
export function readSession(db: Db, token: string, now = new Date()) {
  const id = tokenHash(token);
  const row = db
    .select({ expiresAt: sessions.expiresAt, user: users, role: roles })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  const left = Date.parse(row.expiresAt) - now.getTime();
  if (left <= 0) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  if (!isEnabled(row)) return null;
  const refreshed = left < TTL_MS / 2;
  const expiresAt = refreshed ? expiry(now) : row.expiresAt;
  if (refreshed) db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id)).run();
  return { user: sessionUser(row.user, row.role), expiresAt, refreshed };
}

export const deleteSession = (db: Db, token: string) =>
  db
    .delete(sessions)
    .where(eq(sessions.id, tokenHash(token)))
    .run();

/** Logs a user out everywhere (disabled, password reset). */
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
