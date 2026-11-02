import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { PERMISSION_LEVELS, ROLE_BUILT_INS } from "./enums.ts";

const level = z.enum(PERMISSION_LEVELS);

/** ADR-0016 permission catalog: modules have a level, the rest are on or off. */
export const permissionsSchema = z.object({
  printers: level,
  maintenance: level,
  filament: level,
  projects: level,
  prints: level,
  costs: level,
  stats: z.enum(["none", "read"]),
  "integrations.sync": z.boolean(),
  "integrations.review": z.boolean(),
  "integrations.manage": z.boolean(),
  "hub.manage": z.boolean(),
  "settings.server": z.boolean(),
  "settings.backup": z.boolean(),
  "settings.logs": z.boolean(),
  "settings.branding": z.boolean(),
  "settings.alerts": z.boolean(),
  "users.manage": z.boolean(),
});

/** ADR-0016 project rights (they replace ADR-0014's per-user switches). */
export const projectRightsSchema = z.object({
  "projects.seeAll": z.boolean(),
  "projects.editOthers": z.boolean(),
  "projects.editOtherDevices": z.boolean(),
});

/** A user's overrides on their role: a missing key = same as role. */
export const permissionOverridesSchema = permissionsSchema.partial();
export const projectRightOverridesSchema = projectRightsSchema.partial();

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];
export type RoleBuiltIn = (typeof ROLE_BUILT_INS)[number];
export type Permissions = z.infer<typeof permissionsSchema>;
export type Permission = keyof Permissions;
/** The permissions with levels; the rest are on or off. */
export type PermissionModule = {
  [K in Permission]: Permissions[K] extends boolean ? never : K;
}[Permission];
export type PermissionSwitch = Exclude<Permission, PermissionModule>;
export type ProjectRights = z.infer<typeof projectRightsSchema>;
export type ProjectRight = keyof ProjectRights;
export type RoleRights = { permissions: Permissions; projectRights: ProjectRights };

const modules = (l: PermissionLevel, stats: "none" | "read") => ({
  printers: l,
  maintenance: l,
  filament: l,
  projects: l,
  prints: l,
  costs: l,
  stats,
});
const switches = (on: boolean) => ({
  "integrations.sync": on,
  "integrations.review": on,
  "integrations.manage": on,
  "hub.manage": on,
  "settings.server": on,
  "settings.backup": on,
  "settings.logs": on,
  "settings.branding": on,
  "settings.alerts": on,
  "users.manage": on,
});

/** The base every role starts from; a key a later version adds stays here, so it fails closed. */
export const NO_RIGHTS: RoleRights = {
  permissions: { ...modules("none", "none"), ...switches(false) },
  projectRights: {
    "projects.seeAll": false,
    "projects.editOthers": false,
    "projects.editOtherDevices": false,
  },
};

/** The seeded roles (ADR-0016 tables); migration 0086 inserts the same values. */
export const BUILT_IN_RIGHTS: Record<RoleBuiltIn, RoleRights> = {
  admin: {
    permissions: { ...modules("manage", "read"), ...switches(true) },
    projectRights: {
      "projects.seeAll": true,
      "projects.editOthers": true,
      "projects.editOtherDevices": true,
    },
  },
  editor: {
    permissions: {
      ...modules("write", "read"),
      ...switches(false),
      "integrations.sync": true,
      "integrations.review": true,
    },
    projectRights: {
      "projects.seeAll": true,
      "projects.editOthers": true,
      "projects.editOtherDevices": false,
    },
  },
  viewer: {
    permissions: { ...modules("read", "read"), ...switches(false) },
    projectRights: {
      "projects.seeAll": true,
      "projects.editOthers": false,
      "projects.editOtherDevices": false,
    },
  },
};

/** Fixed ids of the seeded roles (migration 0086). */
export const BUILT_IN_ROLE_IDS: Record<RoleBuiltIn, string> = {
  admin: "00000000-0000-4000-8000-000000000001",
  editor: "00000000-0000-4000-8000-000000000002",
  viewer: "00000000-0000-4000-8000-000000000003",
};

/** What a user may do: `admin` = the Admin role (or the no-users mode). */
export const effectiveRightsSchema = z.object({
  admin: z.boolean(),
  permissions: permissionsSchema,
  projectRights: projectRightsSchema,
});
export type EffectiveRights = z.infer<typeof effectiveRightsSchema>;

export const ADMIN_EFFECTIVE: EffectiveRights = { admin: true, ...BUILT_IN_RIGHTS.admin };

type Overrides = { permissions: Partial<Permissions>; projectRights: Partial<ProjectRights> };

/**
 * Role values, then the user's overrides on top (ADR-0016). The Admin role always has everything;
 * of its users' overrides only `projects.editOtherDevices` counts.
 */
export function effectiveRights(
  role: Partial<Overrides> & { builtIn: RoleBuiltIn | null },
  user: Overrides = { permissions: {}, projectRights: {} },
): EffectiveRights {
  if (role.builtIn === "admin") {
    const devices = user.projectRights["projects.editOtherDevices"];
    return devices === undefined
      ? ADMIN_EFFECTIVE
      : {
          ...ADMIN_EFFECTIVE,
          projectRights: { ...ADMIN_EFFECTIVE.projectRights, "projects.editOtherDevices": devices },
        };
  }
  return {
    admin: false,
    permissions: { ...NO_RIGHTS.permissions, ...role.permissions, ...user.permissions },
    projectRights: { ...NO_RIGHTS.projectRights, ...role.projectRights, ...user.projectRights },
  };
}

const rank = (v: PermissionLevel | boolean) =>
  typeof v === "boolean" ? Number(v) : PERMISSION_LEVELS.indexOf(v);

/** Whether a module is at `min` or above. */
export const hasLevel = (p: Permissions, module: PermissionModule, min: PermissionLevel) =>
  rank(p[module]) >= rank(min);

/** The keys in `values` above what `own` has (ADR-0016 escalation rule). */
export function exceeds(own: EffectiveRights, values: Partial<Overrides>): string[] {
  type Value = PermissionLevel | boolean;
  const over = (mine: Record<string, Value>, set: Record<string, Value | undefined> = {}) =>
    Object.entries(set)
      .filter(([k, v]) => v !== undefined && rank(v) > rank(mine[k] ?? false))
      .map(([k]) => k);
  return [
    ...over(own.permissions, values.permissions),
    ...over(own.projectRights, values.projectRights),
  ];
}

const name = z.string().trim().min(1).max(100);

/** A role as the API returns it. */
export const roleSchema = z.object({
  id,
  name: z.string(),
  builtIn: z.enum(ROLE_BUILT_INS).nullable(),
  disabled: z.boolean(),
  permissions: permissionsSchema,
  projectRights: projectRightsSchema,
  usersCount: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** `POST /api/roles`; a left-out permission or right is none (off). */
export const roleCreateSchema = z.object({
  name,
  disabled: z.boolean().optional(),
  permissions: permissionOverridesSchema.strict().optional(),
  projectRights: projectRightOverridesSchema.strict().optional(),
});

/** `PATCH /api/roles/:id`; `permissions` and `projectRights` merge into the stored ones. */
export const rolePatchSchema = roleCreateSchema.partial().strict();

export type Role = z.infer<typeof roleSchema>;
export type RoleCreateInput = z.input<typeof roleCreateSchema>;
export type RolePatch = z.input<typeof rolePatchSchema>;
