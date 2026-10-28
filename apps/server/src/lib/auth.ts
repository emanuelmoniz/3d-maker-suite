import { createHash, timingSafeEqual } from "node:crypto";
import { type Capability, ROOT_HUB, type UserRole } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "../errors.ts";
import { policyOf } from "../integrations/capabilities.ts";
import { accessGuard, isLoopback } from "./access.ts";
import { readPreferences } from "./preferences.ts";
import { readCookie, readSession, SESSION_COOKIE, sessionCookie, tokenHash } from "./session.ts";

type SessionUser = NonNullable<ReturnType<typeof readSession>>["user"];
declare module "fastify" {
  interface FastifyRequest {
    /** The logged-in user; unset in the no-users mode and on public routes. */
    user?: SessionUser;
    /** The paired device behind a `Bearer` token (ADR-0014); it acts as `user`. */
    deviceId?: string;
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

export type Rights = Pick<
  SessionUser,
  "id" | "role" | "projectsSeeAll" | "projectsEditOthers" | "editOtherDevices"
>;
type Root = typeof schema.roots.$inferSelect;
/** What `mayEditRoot` needs of a root: its `editBy`, picked users and, on a device, the device's user. */
export type RootRule = Pick<Root, "editBy" | "location"> & {
  editorIds: string[];
  deviceUserId: string | null;
};

/**
 * Whether `user` may edit files in a root (ADR-0014). No user (no-users mode): yes. On a device
 * root its own user always may; anyone else follows `editBy`, and needs `editOtherDevices` there
 * unless picked by name.
 */
export function mayEditRoot(user: Rights | undefined, root: RootRule) {
  if (!user) return true;
  if (user.role === "viewer") return false;
  const device = root.location !== ROOT_HUB;
  if (device && root.deviceUserId === user.id) return true;
  if (root.editBy === "none") return false;
  if (root.editBy === "users") return root.editorIds.includes(user.id);
  if (root.editBy === "admins" && user.role !== "admin") return false;
  return !device || user.editOtherDevices;
}

/**
 * What `user` may do with a project (ADR-0014). "none": hidden (not theirs and they see only their
 * own). "edit" needs the root's edit right (a project without a folder has no root) and the
 * project being theirs, or being an admin, or `projectsEditOthers`. Else "read": download only.
 */
export function projectAccess(
  user: Rights | undefined,
  project: { ownerId: string | null },
  root: RootRule | null,
): "edit" | "read" | "none" {
  if (!user) return "edit";
  const mine = project.ownerId === user.id;
  const admin = user.role === "admin";
  if (!mine && !admin && !user.projectsSeeAll) return "none";
  if (user.role === "viewer" || (root && !mayEditRoot(user, root))) return "read";
  return mine || admin || user.projectsEditOthers ? "edit" : "read";
}

/** A root's `RootRule` from the database. */
export function rootRule(db: Db, root: Root): RootRule {
  const { devices, rootEditors } = schema;
  const deviceUserId =
    root.location === ROOT_HUB
      ? null
      : (db.select({ id: devices.userId }).from(devices).where(eq(devices.id, root.location)).get()
          ?.id ?? null);
  const editorIds = db
    .select({ id: rootEditors.userId })
    .from(rootEditors)
    .where(eq(rootEditors.rootId, root.id))
    .all()
    .map((r) => r.id);
  return { editBy: root.editBy, location: root.location, editorIds, deviceUserId };
}

/** `projectAccess` of a stored project; "edit" for an unknown id, so its route answers 404. */
export function projectAccessOf(db: Db, user: Rights | undefined, id: string) {
  if (!user) return "edit";
  const { projects, roots } = schema;
  const p = db
    .select({ ownerId: projects.ownerId, root: roots })
    .from(projects)
    .leftJoin(roots, eq(roots.id, projects.rootId))
    .where(eq(projects.id, id))
    .get();
  if (!p) return "edit";
  return projectAccess(user, p, p.root && rootRule(db, p.root));
}

/** The list condition for the projects `user` sees (ADR-0014); undefined = all. */
export const visibleProjects = (user: Rights | undefined): SQL | undefined =>
  !user || user.role === "admin" || user.projectsSeeAll
    ? undefined
    : eq(schema.projects.ownerId, user.id);

/** `visibleProjects` as an expression on a `projects` row (joins, subqueries, CASE). */
export const projectVisible = (user: Rights | undefined): SQL => visibleProjects(user) ?? sql`1`;

/** 403 unless `user` may edit files in `root` (create a project there, link one of its folders). */
export function assertRootEditable(db: Db, user: Rights | undefined, root: Root) {
  if (!mayEditRoot(user, rootRule(db, root)))
    throw new HttpError(403, "forbidden", "You can't change files in this folder");
}

const PROJECT_PATH = /^\/api\/projects\/([0-9a-f-]{36})(\/|$)/i;

/** No session needed: the SPA and its assets (the login page has to load), health, setup, login, device pairing. */
export const isPublic = (url: string) => {
  const path = url.split("?")[0] ?? "";
  return (
    !path.startsWith("/api/") ||
    ["/api/health", "/api/auth/setup", "/api/auth/login", "/api/hub/pair"].includes(path)
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

const SEEN_EVERY_MS = 15_000;

/**
 * The enabled user behind a device token, or null (unknown or revoked token, user disabled, hub
 * off). Marks the device seen, at most every 15 s.
 */
export function readDevice(db: Db, token: string, now = new Date()) {
  if (!readPreferences(db).hubEnabled) return null;
  const { devices, users } = schema;
  const row = db
    .select({ id: devices.id, user: users })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(eq(devices.tokenHash, tokenHash(token)))
    .get();
  if (!row || row.user.disabled) return null;
  const stale = new Date(now.getTime() - SEEN_EVERY_MS).toISOString();
  db.update(devices)
    .set({ lastSeenAt: now.toISOString() })
    .where(
      and(eq(devices.id, row.id), or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, stale))),
    )
    .run();
  const { passwordHash: _, ...user } = row.user;
  return { deviceId: row.id, user };
}

/**
 * The one onRequest hook (ADR-0012). No users: the old access guard (host guard, `APP_PASSWORD`).
 * Users: a session (or a device token, ADR-0014) for everything but the public routes, then the
 * role table. The host guard stays
 * on for loopback binds, so a DNS-rebinding page can't reach setup from the server's own browser.
 * `allowedHosts` (`APP_ALLOWED_HOSTS`) lists the public names a reverse proxy forwards; both guards accept them.
 */
export function authGuard(
  db: Db,
  access?: { host: string; password?: string; allowedHosts?: string[] },
) {
  const legacy = access && accessGuard(access);
  const hostOnly =
    access &&
    isLoopback(access.host) &&
    accessGuard({ host: access.host, allowedHosts: access.allowedHosts });

  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasUsers(db)) return legacy?.(req, reply);
    const blocked = hostOnly && (await hostOnly(req, reply));
    if (blocked) return blocked;
    if (isPublic(req.url)) return;

    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (bearer) {
      // Not a 401: the connector would take that as a revoke and drop its token.
      if (!readPreferences(db).hubEnabled) return deny(reply, 404, "hub_off", "The hub is off");
      const device = readDevice(db, bearer);
      if (!device) return deny(reply, 401, "unauthorized", "Device not paired");
      req.user = device.user;
      req.deviceId = device.deviceId;
    } else {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const session = token ? readSession(db, token) : null;
      if (!token || !session) return deny(reply, 401, "unauthorized", "Login required");
      if (session.refreshed)
        reply.header("set-cookie", sessionCookie(token, session.expiresAt, isHttps(req)));
      req.user = session.user;
    }
    req.log = req.log.child({ actor: req.user.id });
    // Any role's device holds its event stream and reports on its own roots; the hub routes are
    // admin-only otherwise.
    const path = req.url.split("?")[0] ?? "";
    const own = req.deviceId && (path === "/api/hub/events" || path.startsWith("/api/hub/device/"));
    if (!own && !can(req.user.role, req.url, req.method))
      return deny(reply, 403, "forbidden", "Not allowed for your role");
    // One project's routes (projects, files, slicing): hidden is a 404, download-only refuses writes.
    const projectId = PROJECT_PATH.exec(path)?.[1];
    if (projectId) {
      const access = projectAccessOf(db, req.user, projectId);
      if (access === "none") return deny(reply, 404, "not_found", "Project not found");
      if (access === "read" && !READS.includes(req.method))
        return deny(reply, 403, "forbidden", "This project is download-only for you");
    }
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
