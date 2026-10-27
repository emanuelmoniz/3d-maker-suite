import { createHash, timingSafeEqual } from "node:crypto";
import type { Capability, UserRole } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "../errors.ts";
import { policyOf } from "../integrations/capabilities.ts";
import { accessGuard, isLoopback } from "./access.ts";
import { readCookie, readSession, SESSION_COOKIE, sessionCookie } from "./session.ts";

type SessionUser = NonNullable<ReturnType<typeof readSession>>["user"];
declare module "fastify" {
  interface FastifyRequest {
    /** The logged-in user; unset in the no-users mode and on public routes. */
    user?: SessionUser;
  }
}

/** R = GET/HEAD, RW = every method, "-" = 403. Admin may do everything. */
type Access = "-" | "R" | "RW";

// ADR-0012 role × prefix table. A prefix missing here is admin-only, so a new route fails closed.
const TABLE: Record<string, { viewer: Access; editor: Access }> = {
  auth: { viewer: "RW", editor: "RW" },
  printers: { viewer: "R", editor: "R" },
  // Accessories (installs and removals only) and maintenance tasks are opened up in `can`.
  accessories: { viewer: "R", editor: "R" },
  maintenance: { viewer: "R", editor: "R" },
  brands: { viewer: "R", editor: "R" },
  "printer-models": { viewer: "R", editor: "R" },
  "machine-profiles": { viewer: "R", editor: "R" },
  filament: { viewer: "R", editor: "RW" },
  "filament-brands": { viewer: "R", editor: "R" },
  "filament-materials": { viewer: "R", editor: "R" },
  "print-profiles": { viewer: "R", editor: "R" },
  projects: { viewer: "R", editor: "RW" },
  roots: { viewer: "R", editor: "R" },
  prints: { viewer: "R", editor: "RW" },
  costs: { viewer: "R", editor: "RW" },
  orders: { viewer: "R", editor: "RW" },
  clients: { viewer: "R", editor: "RW" },
  stats: { viewer: "R", editor: "R" },
  tags: { viewer: "R", editor: "RW" },
  collections: { viewer: "R", editor: "RW" },
  alerts: { viewer: "R", editor: "RW" },
  // Writes are narrowed to the caller's allowed keys by the route.
  preferences: { viewer: "RW", editor: "RW" },
  branding: { viewer: "R", editor: "R" },
  integrations: { viewer: "R", editor: "R" },
};

const READS = ["GET", "HEAD"];

/** Whether `role` may call `method url`. The prefix table plus the two rules a prefix can't express. */
export function can(role: UserRole, url: string, method: string): boolean {
  if (role === "admin") return true;
  const path = url.split("?")[0] ?? "";
  // Channels hold webhook and SMTP secrets.
  if (/^\/api\/alerts\/channels(\/|$)/.test(path)) return false;
  // Managed slicer installs download half a gigabyte and ask GitHub (ADR-0013).
  if (/^\/api\/integrations\/[^/]+\/slicer(\/|$)/.test(path)) return false;
  // Everyone reads, snoozes and dismisses their own alerts (ADR-0012); nothing else under /alerts.
  if (method === "PATCH" && /^\/api\/alerts\/[^/]+$/.test(path)) return true;
  // Sync now, and an integration's review and import: narrowed per task by `mayTask` in the route.
  if (
    role === "editor" &&
    method === "POST" &&
    (/^\/api\/integrations\/[^/]+\/sync$/.test(path) ||
      /^\/api\/import\/integration\/[^/]+\/[^/]+$/.test(path) ||
      /^\/api\/import\/[^/]+\/apply$/.test(path))
  )
    return true;
  // Editors log work on printers and accessories; the printer, accessory, maintenance and filament-profile setup is admin-only.
  if (
    role === "editor" &&
    ((/^\/api\/accessories\/[^/]+\/installs(\/|$)/.test(path) && method !== "GET") ||
      (method === "POST" && path === "/api/maintenance/tasks"))
  )
    return true;
  // "Add folder" in Projects browses the server's disk; the route confines editors to the project roots.
  if (
    role === "editor" &&
    ((method === "GET" && path === "/api/fs/list") ||
      (method === "POST" && path === "/api/fs/folder"))
  )
    return true;
  if (role === "editor" && /^\/api\/filament\/profiles(\/|$)/.test(path))
    return READS.includes(method);
  const access = TABLE[/^\/api\/([^/]+)/.exec(path)?.[1] ?? ""]?.[role] ?? "-";
  return access === "RW" || (access === "R" && READS.includes(method));
}

/**
 * ADR-0012 editor flags: admin (and the no-users mode) always, an editor only with the task's
 * flag, a viewer never. The routes `can` opens for editors call this.
 */
export function mayTask(
  db: Db,
  user: SessionUser | undefined,
  integrationId: string,
  type: Capability,
  flag: "editorSync" | "editorReview",
) {
  if (!user || user.role === "admin") return;
  if (user.role === "editor" && policyOf(db, integrationId, type)[flag]) return;
  throw new HttpError(403, "forbidden", "Not allowed for your role");
}

/** No session needed: the SPA and its assets (the login page has to load), health, setup, login. */
export const isPublic = (url: string) => {
  const path = url.split("?")[0] ?? "";
  return (
    !path.startsWith("/api/") ||
    ["/api/health", "/api/auth/setup", "/api/auth/login"].includes(path)
  );
};

export const hasUsers = (db: Db) =>
  !!db.select({ id: schema.users.id }).from(schema.users).limit(1).get();

export const isLoopbackIp = (ip: string) =>
  ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.");

/** Directly or through a reverse proxy. A forged header only makes the cookie Secure. */
export const isHttps = (req: FastifyRequest) =>
  req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";

const digest = (s: string) => createHash("sha256").update(s).digest();
export const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const deny = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.status(status).send({ error: { code, message } });

/**
 * The one onRequest hook (ADR-0012). No users: the old access guard (host guard, `APP_PASSWORD`).
 * Users: a session for everything but the public routes, then the role table. The host guard stays
 * on for loopback binds, so a DNS-rebinding page can't reach setup from the server's own browser.
 */
export function authGuard(db: Db, access?: { host: string; password?: string }) {
  const legacy = access && accessGuard(access);
  const hostOnly = access && isLoopback(access.host) && accessGuard({ host: access.host });

  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasUsers(db)) return legacy?.(req, reply);
    const blocked = hostOnly && (await hostOnly(req, reply));
    if (blocked) return blocked;
    if (isPublic(req.url)) return;

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = token ? readSession(db, token) : null;
    if (!token || !session) return deny(reply, 401, "unauthorized", "Login required");
    if (session.refreshed)
      reply.header("set-cookie", sessionCookie(token, session.expiresAt, isHttps(req)));
    req.user = session.user;
    req.log = req.log.child({ actor: session.user.id });
    if (!can(session.user.role, req.url, req.method))
      return deny(reply, 403, "forbidden", "Not allowed for your role");
  };
}

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

/** 5 failed logins per email + IP lock that pair for 15 minutes. In memory: a restart clears it. */
export function loginLimiter(now = Date.now) {
  const fails = new Map<string, { n: number; at: number }>();
  const live = (k: string) => {
    const e = fails.get(k);
    return e && now() - e.at < LOCK_MS ? e : undefined;
  };
  return {
    locked: (k: string) => (live(k)?.n ?? 0) >= MAX_FAILS,
    fail(k: string) {
      // ponytail: sweeps only when big; a timer if memory ever matters.
      if (fails.size > 10_000)
        for (const [key, e] of fails) if (now() - e.at >= LOCK_MS) fails.delete(key);
      fails.set(k, { n: (live(k)?.n ?? 0) + 1, at: now() });
    },
    clear: (k: string) => fails.delete(k),
  };
}
