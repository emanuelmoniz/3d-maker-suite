import { createHash, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import {
  type AlertKind,
  BULK_ITEMS,
  type BulkKind,
  type Capability,
  type EffectiveRights,
  exceeds,
  hasLevel,
  type MachineSection,
  mayEditMachine,
  mayViewMachine,
  type PermissionLevel,
  type PermissionModule,
  type PermissionSwitch,
  ROOT_HUB,
  receivedKinds,
  USER_PREFERENCE_KEYS,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import {
  type AnyColumn,
  and,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "../errors.ts";
import { policyOf } from "../integrations/capabilities.ts";
import { accessGuard, isLoopback } from "./access.ts";
import { readPreferences } from "./preferences.ts";
import {
  isEnabled,
  readCookie,
  readSession,
  SESSION_COOKIE,
  type SessionUser,
  sessionCookie,
  sessionUser,
  tokenHash,
} from "./session.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** The logged-in user; unset in the no-users mode and on public routes. */
    user?: SessionUser;
    /** The paired device behind a `Bearer` token (ADR-0014); it acts as `user`. */
    deviceId?: string;
  }
}

/** Whether the caller's rights meet a rule; `m` is the path's match (the tagged module needs it). */
type Need = (r: EffectiveRights, m?: RegExpExecArray) => boolean;
const at =
  (module: PermissionModule, level: PermissionLevel): Need =>
  (r) =>
    hasLevel(r.permissions, module, level);
const on =
  (p: PermissionSwitch): Need =>
  (r) =>
    r.permissions[p];
const either =
  (...needs: Need[]): Need =>
  (r, m) =>
    needs.some((n) => n(r, m));
const SESSION: Need = () => true;
/** The Admin role only; `can` lets it through before the rules. */
const ADMIN_ROLE: Need = () => false;
/** Write or manage on a module, or any on/off permission. */
const ANY_WRITE: Need = (r) =>
  Object.values(r.permissions).some((v) => v === true || v === "write" || v === "manage");
const TAG_MODULE: Record<string, PermissionModule> = {
  project: "projects",
  print: "prints",
  spool: "filament",
  printer: "printers",
  accessory: "printers",
};
const TAGGED: Need = (r, m) => {
  const module = TAG_MODULE[m?.[1] ?? ""];
  return !!module && hasLevel(r.permissions, module, "write");
};
/** Bulk needs manage on the item's module, whatever one row of it needs (ADR-0018). */
const BULK: Need = (r, m) => {
  const module = BULK_ITEMS[m?.[1] as BulkKind]?.module;
  return !!module && hasLevel(r.permissions, module, "manage");
};

/** `^/api/(a|b)` followed by a slash or the end. */
const p = (prefixes: string) => new RegExp(`^/api/(${prefixes})(/|$)`);
const PRINTERS = "printers|accessories";
const CATALOG = "brands|printer-models|filament-brands|filament-materials";
const PRESETS = "machine-presets|process-presets|filament/presets";
const ROOTS_OR_SLICERS = either(at("projects", "write"), on("integrations.manage"));

// ADR-0016 permission table: [path, methods (R = GET/HEAD, W = the rest, * = all, or one method),
// need]. First match wins; a path no rule matches is Admin role only, so a new route fails closed.
const RULES: [RegExp, string, Need][] = [
  [p("auth"), "*", SESSION],
  // Writes are narrowed to the caller's keys by the route.
  [/^\/api\/preferences$/, "*", SESSION],
  [p("branding"), "R", SESSION],
  [p("branding"), "W", on("settings.branding")],
  // Channels hold the mail and ntfy servers' secrets.
  [p("alerts/channels"), "*", on("settings.alerts")],
  // Everyone reads, snoozes and dismisses their own alerts (ADR-0012).
  [/^\/api\/alerts\/[^/]+$/, "PATCH", SESSION],
  // Which kinds no enabled user gets: it looks at everyone's rights.
  [p("alerts/coverage"), "*", on("settings.alerts")],
  [p("alerts"), "R", SESSION],
  // `POST /alerts/evaluate`.
  [p("alerts"), "W", ANY_WRITE],
  [/^\/api\/tags\/taggings\/([^/]+)\//, "W", TAGGED],
  [p("tags"), "R", SESSION],
  [p("tags"), "W", ANY_WRITE],
  [/^\/api\/bulk\/([^/]+)$/, "POST", BULK],
  // ADR-0020: the printer, spool and print forms' pickers read the catalog without `catalog`.
  [p(CATALOG), "R", either(at("printers", "read"), at("filament", "read"), at("catalog", "read"))],
  [p(CATALOG), "W", at("catalog", "manage")],
  // ADR-0021: the same pickers read presets, and Catalog's slicer columns (ADR-0023).
  [p(PRESETS), "R", either(at("printers", "read"), at("filament", "read"), at("catalog", "read"))],
  [p(PRESETS), "W", at("catalog", "manage")],
  [p(PRINTERS), "R", at("printers", "read")],
  // Logging work on accessories is write; their setup, and the printers', is manage.
  [/^\/api\/accessories\/[^/]+\/installs(\/|$)/, "W", at("printers", "write")],
  [p(PRINTERS), "W", at("printers", "manage")],
  [p("maintenance"), "R", at("maintenance", "read")],
  [/^\/api\/maintenance\/tasks$/, "POST", at("maintenance", "write")],
  [p("maintenance"), "W", at("maintenance", "manage")],
  [p("filament"), "R", at("filament", "read")],
  [p("filament"), "W", at("filament", "write")],
  // Changing the root of many projects; each project and the root are checked by the route too.
  [/^\/api\/projects\/(folders|relink)$/, "*", at("projects", "manage")],
  [p("projects|collections|roots"), "R", at("projects", "read")],
  [p("projects|collections"), "W", at("projects", "write")],
  [p("roots"), "W", at("projects", "manage")],
  // "Add folder" in Projects browses the disk; the route confines it to the project roots.
  [/^\/api\/fs\/list$/, "GET", ROOTS_OR_SLICERS],
  [/^\/api\/fs\/folder$/, "POST", ROOTS_OR_SLICERS],
  [p("fs"), "*", either(at("projects", "manage"), on("integrations.manage"))],
  [p("prints"), "R", at("prints", "read")],
  [p("prints"), "W", at("prints", "write")],
  [p("costs|orders|clients"), "R", at("costs", "read")],
  [p("costs|orders|clients"), "W", at("costs", "write")],
  [p("stats"), "R", at("stats", "read")],
  // Managed slicer installs download half a gigabyte and ask GitHub (ADR-0013).
  [/^\/api\/integrations\/[^/]+\/slicer(\/|$)/, "*", on("integrations.manage")],
  // Sync now, and an integration's review and import: narrowed per task by `mayTask` in the route.
  [
    /^\/api\/integrations\/[^/]+\/sync$/,
    "POST",
    either(on("integrations.sync"), on("integrations.manage")),
  ],
  // Catalog import cards (presets too) are catalog manage, the rest integrations.manage: narrowed
  // by the route.
  [
    /^\/api\/integrations\/[^/]+$/,
    "PATCH",
    either(on("integrations.manage"), at("catalog", "manage")),
  ],
  // The setup fields are left out without integrations.manage (route).
  [p("integrations"), "R", SESSION],
  [
    /^\/api\/import\/(integration\/[^/]+\/[^/]+|[^/]+\/apply)$/,
    "POST",
    either(on("integrations.review"), on("integrations.manage")),
  ],
  // Choose brands on Catalog → Sources: a Sources setting (ADR-0020).
  [
    /^\/api\/import\/catalog\/[^/]+$/,
    "*",
    either(on("integrations.manage"), at("catalog", "manage")),
  ],
  [p("integrations|import|slicer-zip"), "*", on("integrations.manage")],
  // The machine page (ADR-0021): its own user too, narrowed by the route (`machineGuard`). Revoke,
  // pairing, a user code and Update now stay hub.manage.
  [/^\/api\/hub\/devices$/, "R", SESSION],
  [/^\/api\/hub\/devices\/[^/]+\/(settings|folders)$/, "*", SESSION],
  [/^\/api\/hub\/devices\/[^/]+\/(restart|stop)$/, "POST", SESSION],
  [/^\/api\/hub\/devices\/[^/]+$/, "PATCH", SESSION],
  // Picks (ADR-0021): hub.manage or projects manage, checked by the route.
  [/^\/api\/hub\/devices\/[^/]+\/picks(\/[^/]+)?$/, "*", SESSION],
  [/^\/api\/hub\/devices\/[^/]+\/slicers\/[^/]+$/, "PATCH", SESSION],
  [p("hub"), "*", on("hub.manage")],
  // ADR-0017, ADR-0021: the machines' preset lines and their held deletes are catalog write; the
  // switches themselves are the machine's (`/hub/devices/:id/slicers/:library`).
  [p("presets/devices"), "*", at("catalog", "write")],
  // Shown in Catalog and Presets settings → Sources, read-only; and on Integrations' slicer cards,
  // where the hub's slicer is picked.
  [p("catalog/sources"), "R", either(at("catalog", "read"), on("integrations.manage"))],
  [p("presets"), "R", either(at("projects", "read"), at("catalog", "read"))],
  [p("presets"), "W", at("catalog", "write")],
  [p("server-config|updates|docs"), "*", on("settings.server")],
  // A restored database carries anyone's rights.
  [/^\/api\/backups\/[^/]+\/restore$/, "*", ADMIN_ROLE],
  [p("backups"), "*", on("settings.backup")],
  [p("logs"), "*", on("settings.logs")],
  // A root's picked editors.
  [/^\/api\/users$/, "GET", either(on("users.manage"), at("projects", "manage"))],
  [p("users|roles"), "*", on("users.manage")],
];

const keys = (need: Need, ...names: string[]) => names.map((k) => [k, need] as const);
// ADR-0016 preference keys. Each user's own display keys are always allowed; a key missing here
// is Admin role only.
const KEYS: Record<string, Need> = Object.fromEntries([
  ...keys(at("printers", "manage"), "defaultPrinterId", "printerStates"),
  ...keys(at("projects", "manage"), "projectScanMaxFiles", "viewerMaxMb", "projectUploadMaxMb"),
  ...keys(at("prints", "manage"), "gramsPerHour", "failureReasons"),
  ...keys(
    at("costs", "manage"),
    "currency",
    "energyCostPerKwh",
    "laborRatePerHour",
    "failureMarginPct",
    "markupPct",
    "printerLifetimeHours",
    "printerCountInCosts",
    "includeMaintenanceCost",
    "accessoryLifetimeHours",
    "accessoryCountInCosts",
    "accessoryIncludeMaintenanceCost",
    "orderStatuses",
  ),
  ...keys(on("integrations.manage"), "defaultSlicerId"),
  ...keys(
    on("hub.manage"),
    "hubEnabled",
    "hubDeleteGuard",
    "hubLocks",
    "hubLockIdleMin",
    "hubVersions",
    "hubVersionsKeep",
    "hubDefaultSyncMode",
    "deviceFolderMaxMb",
  ),
  ...keys(on("settings.server"), "updateChannel"),
  ...keys(on("settings.backup"), "backupAuto", "backupKeep"),
  ...keys(
    on("settings.logs"),
    "logActive",
    "logLevels",
    "logModules",
    "logRetentionDays",
    "logMaxEntries",
  ),
  ...keys(on("settings.branding"), "appName"),
  ...keys(
    on("settings.alerts"),
    "lowSpoolGrams",
    "maintenanceLeadDays",
    "maintenanceLeadHours",
    "maintenanceLeadPrints",
  ),
]);
const OWN_KEYS: readonly string[] = USER_PREFERENCE_KEYS;

/** Whether `rights` may change the preference `key` (a global one, or their own display key). */
export const mayPatchKey = (rights: EffectiveRights, key: string) =>
  rights.admin || OWN_KEYS.includes(key) || !!KEYS[key]?.(rights);

/** The entries of `next` that differ from `prev`: what a patch actually changes. */
export const changed = <T extends object>(next: Partial<T> | undefined, prev: Partial<T>) =>
  next &&
  (Object.fromEntries(
    Object.entries(next).filter(([k, v]) => prev[k as keyof T] !== v),
  ) as Partial<T>);

/**
 * ADR-0016 escalation rule: a user manager outside the Admin role sets nothing above their own
 * effective value (no user = the no-users mode, the Admin role).
 */
export function assertWithin(
  caller: SessionUser | undefined,
  values: Parameters<typeof exceeds>[1],
) {
  if (!caller || caller.rights.admin) return;
  const over = exceeds(caller.rights, values);
  if (over.length)
    throw new HttpError(403, "escalation", `More than you have yourself: ${over.join(", ")}`);
}

const READS = ["GET", "HEAD"];

/** Whether `rights` may call `method url` (ADR-0016). The Admin role may do everything. */
export function can(rights: EffectiveRights, url: string, method: string): boolean {
  if (rights.admin) return true;
  const path = url.split("?")[0] ?? "";
  const read = READS.includes(method);
  for (const [re, methods, need] of RULES) {
    if (methods === "R" ? !read : methods === "W" ? read : methods !== "*" && methods !== method)
      continue;
    const m = re.exec(path);
    if (m) return need(rights, m);
  }
  return false;
}

/**
 * The per-task gate on sync and review (ADR-0016): `integrations.manage` (and the no-users mode)
 * always; with only `integrations.sync` (`.review`), the task's flag must be on.
 */
export function mayTask(
  db: Db,
  user: SessionUser | undefined,
  integrationId: string,
  type: Capability,
  flag: "editorSync" | "editorReview",
) {
  const p = user?.rights.permissions;
  if (!p || p["integrations.manage"]) return;
  const allowed = flag === "editorSync" ? p["integrations.sync"] : p["integrations.review"];
  if (allowed && policyOf(db, integrationId, type)[flag]) return;
  throw new HttpError(403, "forbidden", "Not allowed for your role");
}

/**
 * A machine page route (ADR-0021): the device, once the caller may see its page, or edit `section`
 * of it ("manage": hub.manage only). 404 for an unknown device; no user (no-users mode) may all.
 */
export function machineGuard(
  db: Db,
  user: SessionUser | undefined,
  deviceId: string,
  section?: MachineSection | "manage",
) {
  const row = db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get();
  if (!row) throw new HttpError(404, "not_found", "Device not found");
  if (!user) return row;
  const { rights } = user;
  const ok =
    section === "manage"
      ? rights.admin || rights.permissions["hub.manage"]
      : section
        ? mayEditMachine(rights, user.id, row, section)
        : mayViewMachine(rights, user.id, row);
  // Someone else's machine is as unknown as a missing one.
  if (!mayViewMachine(rights, user.id, row))
    throw new HttpError(404, "not_found", "Device not found");
  if (!ok) throw new HttpError(403, "forbidden", "Not allowed for your role");
  return row;
}

export type Rights = Pick<SessionUser, "id" | "rights">;
type Root = typeof schema.roots.$inferSelect;
/** What `mayEditRoot` needs of a root: its `editBy`, picked users and, on a device, the device's user. */
export type RootRule = Pick<Root, "editBy" | "location"> & {
  editorIds: string[];
  deviceUserId: string | null;
};

/**
 * Whether `user` may edit files in a root (ADR-0014, in ADR-0016 permissions). No user (no-users
 * mode): yes. It needs projects write. On a device root its own user always may; anyone else
 * follows `editBy`, and needs `projects.editOtherDevices` there unless picked by name.
 */
export function mayEditRoot(user: Rights | undefined, root: RootRule) {
  if (!user) return true;
  const { admin, permissions, projectRights } = user.rights;
  if (!hasLevel(permissions, "projects", "write")) return false;
  const device = root.location !== ROOT_HUB;
  if (device && root.deviceUserId === user.id) return true;
  if (root.editBy === "none") return false;
  if (root.editBy === "users") return root.editorIds.includes(user.id);
  if (root.editBy === "admins" && !admin) return false;
  return !device || projectRights["projects.editOtherDevices"];
}

/**
 * What `user` may do with a project (ADR-0014). "none": hidden (not theirs, and no
 * `projects.seeAll`). "edit" needs the root's edit right (a project without a folder has no root)
 * and the project being theirs or `projects.editOthers`. Else "read": download only.
 */
export function projectAccess(
  user: Rights | undefined,
  project: { ownerId: string | null },
  root: RootRule | null,
): "edit" | "read" | "none" {
  if (!user) return "edit";
  const mine = project.ownerId === user.id;
  const { permissions, projectRights } = user.rights;
  if (!mine && !projectRights["projects.seeAll"]) return "none";
  if (!hasLevel(permissions, "projects", "write") || (root && !mayEditRoot(user, root)))
    return "read";
  return mine || projectRights["projects.editOthers"] ? "edit" : "read";
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
  !user || user.rights.projectRights["projects.seeAll"]
    ? undefined
    : eq(schema.projects.ownerId, user.id);

/** `visibleProjects` as an expression on a `projects` row (joins, subqueries, CASE). */
export const projectVisible = (user: Rights | undefined): SQL => visibleProjects(user) ?? sql`1`;

const PROJECT_KINDS: AlertKind[] = ["slice_setup_changed", "slice_failed", "hub_conflict"];

/**
 * The alerts `user` gets (ADR-0016), as a condition on `alerts`: a kind they subscribe to and have
 * the permission for; a project's alert only when they see the project (a hub conflict outside a
 * project needs only the kind); a sync task's only when its policy flag lets them, unless they have
 * `integrations.manage`. undefined = all (the no-users mode).
 */
export function alertVisible(
  user: Pick<SessionUser, "id" | "rights" | "subscriptions"> | undefined,
): SQL | undefined {
  if (!user) return undefined;
  const { alerts, projects, syncPolicies } = schema;
  const { permissions, projectRights } = user.rights;
  const kinds = receivedKinds(permissions, user.subscriptions);
  if (!kinds.length) return sql`0`;
  const ctx = (key: string) => sql`json_extract(${alerts.context}, ${`$.${key}`})`;
  const project = ctx("projectId");
  const policy = (flag: AnyColumn) =>
    sql`EXISTS (SELECT 1 FROM ${syncPolicies} WHERE ${syncPolicies.integrationId} = ${ctx("integrationId")} AND ${syncPolicies.type} = ${ctx("type")} AND ${flag})`;
  return and(
    inArray(alerts.kind, kinds),
    projectRights["projects.seeAll"]
      ? undefined
      : or(
          notInArray(alerts.kind, PROJECT_KINDS),
          sql`${project} IS NULL`,
          sql`EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.id} = ${project} AND ${projectVisible(user)})`,
        ),
    permissions["integrations.manage"]
      ? undefined
      : or(
          notInArray(alerts.kind, ["sync_pending", "sync_success", "sync_error"]),
          and(eq(alerts.kind, "sync_pending"), policy(syncPolicies.editorReview)),
          and(
            inArray(alerts.kind, ["sync_success", "sync_error"]),
            policy(syncPolicies.editorSync),
          ),
        ),
  );
}

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

/**
 * The request comes from the server's own machine: the client is loopback or one of this machine's
 * addresses (a browser here using its LAN IP or a DNS name for it). The Host is the access guard's
 * job. An `X-Forwarded-For` that `trustProxy` didn't resolve is a proxy here forwarding someone
 * else, so it never counts.
 */
export function fromThisPc(req: FastifyRequest) {
  if (req.headers["x-forwarded-for"] && req.ip === req.socket.remoteAddress) return false;
  if (isLoopbackIp(req.ip)) return true;
  const ip = req.ip.replace(/^::ffff:/, "");
  return Object.values(networkInterfaces()).some((list) => list?.some((a) => a.address === ip));
}

/** Directly or through a reverse proxy. A forged header only makes the cookie Secure. */
export const isHttps = (req: FastifyRequest) =>
  req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";

const digest = (s: string) => createHash("sha256").update(s).digest();
export const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const deny = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.status(status).send({ error: { code, message } });

const SEEN_EVERY_MS = 15_000;

/**
 * The enabled user behind a device token, or null (unknown or revoked token, user or role disabled, hub
 * off). Marks the device seen, at most every 15 s.
 */
export function readDevice(db: Db, token: string, now = new Date()) {
  if (!readPreferences(db).hubEnabled) return null;
  const { devices, roles, users } = schema;
  const row = db
    .select({ id: devices.id, user: users, role: roles })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(devices.tokenHash, tokenHash(token)))
    .get();
  if (!row || !isEnabled(row)) return null;
  const stale = new Date(now.getTime() - SEEN_EVERY_MS).toISOString();
  db.update(devices)
    .set({ lastSeenAt: now.toISOString() })
    .where(
      and(eq(devices.id, row.id), or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, stale))),
    )
    .run();
  return { deviceId: row.id, user: sessionUser(row.user, row.role) };
}

/**
 * The one onRequest hook (ADR-0012). No users: the old access guard (host guard, `APP_PASSWORD`).
 * Users: a session (or a device token, ADR-0014) for everything but the public routes, then the
 * permission table. The host guard stays
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
    // Any user's device holds its event stream and reports on its own roots; the hub routes need
    // hub.manage otherwise.
    const path = req.url.split("?")[0] ?? "";
    const own = req.deviceId && (path === "/api/hub/events" || path.startsWith("/api/hub/device/"));
    if (!own && !can(req.user.rights, req.url, req.method))
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
