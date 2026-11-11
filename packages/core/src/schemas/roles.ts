import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import {
  ALERT_KINDS,
  ALERT_SUBSCRIPTIONS,
  type AlertKind,
  PERMISSION_LEVELS,
  ROLE_BUILT_INS,
} from "./enums.ts";

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
  catalog: level,
  presets: level,
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
  // ADR-0021: a machine's own user edits these sections of its page.
  "machine.connection": z.boolean(),
  "machine.slicers": z.boolean(),
  "machine.catalog": z.boolean(),
  "machine.presets": z.boolean(),
  "machine.projects": z.boolean(),
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
  catalog: l,
  presets: l,
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
  "machine.connection": on,
  "machine.slicers": on,
  "machine.catalog": on,
  "machine.presets": on,
  "machine.projects": on,
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

/** A section of a machine's page (ADR-0021) and the module its data needs at write, if any. */
export const MACHINE_SECTIONS = {
  connection: null,
  slicers: null,
  catalog: "catalog",
  presets: "presets",
  projects: "projects",
} as const satisfies Record<string, PermissionModule | null>;
export type MachineSection = keyof typeof MACHINE_SECTIONS;

/** Whether a user sees a machine's page: `hub.manage`, or it is paired to them. */
export const mayViewMachine = (
  rights: EffectiveRights,
  userId: string | undefined,
  device: { userId: string },
) => rights.admin || rights.permissions["hub.manage"] || device.userId === userId;

/**
 * Whether a user edits a section of a machine's page (ADR-0021): `hub.manage` every machine; its
 * own user with the section's `machine.*` switch, and write on the data's module.
 */
export function mayEditMachine(
  rights: EffectiveRights,
  userId: string | undefined,
  device: { userId: string },
  section: MachineSection,
) {
  if (rights.admin || rights.permissions["hub.manage"]) return true;
  const module = MACHINE_SECTIONS[section];
  return (
    device.userId === userId &&
    rights.permissions[`machine.${section}`] &&
    (!module || hasLevel(rights.permissions, module, "write"))
  );
}

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

export type AlertSubscription = (typeof ALERT_SUBSCRIPTIONS)[number];
type KindRule = {
  /** The permission a user needs to get the kind at all, whatever their subscription says. */
  needs: (p: Permissions) => boolean;
  /** Resolves for everyone when the cause is fixed; otherwise an event each user dismisses. */
  condition: boolean;
  /** A role's value when it sets none: in app, or off for the opt-in checks. */
  default: AlertSubscription;
};

/**
 * ADR-0016 kind catalog. The server adds two rules it alone can check: the sync policy's
 * `editorSync` / `editorReview` without `integrations.manage`, and the project's visibility.
 */
export const ALERT_KIND_CATALOG: Record<AlertKind, KindRule> = {
  maintenance_due: {
    needs: (p) => hasLevel(p, "maintenance", "read"),
    condition: true,
    default: "app",
  },
  spool_low: { needs: (p) => hasLevel(p, "filament", "read"), condition: true, default: "app" },
  spool_no_price: {
    needs: (p) => hasLevel(p, "filament", "read"),
    condition: true,
    default: "off",
  },
  spool_no_open_date: {
    needs: (p) => hasLevel(p, "filament", "read"),
    condition: true,
    default: "off",
  },
  warranty_ending: {
    needs: (p) => hasLevel(p, "printers", "read"),
    condition: true,
    default: "app",
  },
  sync_pending: {
    needs: (p) => p["integrations.review"] || p["integrations.manage"],
    condition: true,
    default: "app",
  },
  sync_success: {
    needs: (p) => p["integrations.sync"] || p["integrations.manage"],
    condition: false,
    default: "app",
  },
  sync_error: {
    needs: (p) => p["integrations.sync"] || p["integrations.manage"],
    condition: false,
    default: "app",
  },
  slice_setup_changed: {
    needs: (p) => hasLevel(p, "projects", "read"),
    condition: false,
    default: "app",
  },
  slice_failed: {
    needs: (p) => hasLevel(p, "projects", "read"),
    condition: false,
    default: "app",
  },
  update_available: { needs: (p) => p["settings.server"], condition: false, default: "app" },
  slicer_update: { needs: (p) => p["integrations.manage"], condition: false, default: "app" },
  connector_outdated: { needs: (p) => p["hub.manage"], condition: true, default: "app" },
  hub_conflict: { needs: (p) => hasLevel(p, "projects", "read"), condition: false, default: "app" },
  hub_mass_delete: { needs: (p) => p["hub.manage"], condition: true, default: "app" },
  preset_conflict: {
    needs: (p) => hasLevel(p, "presets", "write"),
    condition: false,
    default: "app",
  },
  preset_skipped: {
    needs: (p) => hasLevel(p, "presets", "write"),
    condition: false,
    default: "app",
  },
  preset_held: { needs: (p) => hasLevel(p, "presets", "write"), condition: true, default: "app" },
};

const subscription = z.enum(ALERT_SUBSCRIPTIONS);
/** Per kind off · in app · notify; a role or user stores only what it sets (missing = default / same as role). */
export const alertKindsSchema = z
  .object(
    Object.fromEntries(ALERT_KINDS.map((k) => [k, subscription])) as Record<
      AlertKind,
      typeof subscription
    >,
  )
  .partial();
export type AlertKinds = Record<AlertKind, AlertSubscription>;

/** Role values, then the user's overrides, then the catalog default. Permissions gate it separately. */
export const effectiveAlertKinds = (
  role: { alertKinds?: Partial<AlertKinds> },
  user: { alertKinds?: Partial<AlertKinds> } = {},
): AlertKinds =>
  Object.fromEntries(
    ALERT_KINDS.map((k) => [
      k,
      user.alertKinds?.[k] ?? role.alertKinds?.[k] ?? ALERT_KIND_CATALOG[k].default,
    ]),
  ) as AlertKinds;

/** The kinds a user gets (in app at least): subscribed, and the permission to see them. */
export const receivedKinds = (permissions: Permissions, kinds: AlertKinds): AlertKind[] =>
  ALERT_KINDS.filter((k) => kinds[k] !== "off" && ALERT_KIND_CATALOG[k].needs(permissions));

const name = z.string().trim().min(1).max(100);

/** A role as the API returns it. */
export const roleSchema = z.object({
  id,
  name: z.string(),
  builtIn: z.enum(ROLE_BUILT_INS).nullable(),
  disabled: z.boolean(),
  permissions: permissionsSchema,
  projectRights: projectRightsSchema,
  alertKinds: alertKindsSchema,
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
  alertKinds: alertKindsSchema.strict().optional(),
});

/** `PATCH /api/roles/:id`; `permissions`, `projectRights` and `alertKinds` merge into the stored ones. */
export const rolePatchSchema = roleCreateSchema.partial().strict();

export type Role = z.infer<typeof roleSchema>;
export type RoleCreateInput = z.input<typeof roleCreateSchema>;
export type RolePatch = z.input<typeof rolePatchSchema>;
