import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { ROLE_BUILT_INS } from "./enums.ts";
import {
  alertKindsSchema,
  effectiveRightsSchema,
  permissionOverridesSchema,
  projectRightOverridesSchema,
} from "./roles.ts";

/** Overrides on the role (ADR-0016): a missing key = same as role. */
const overrides = {
  permissions: permissionOverridesSchema,
  projectRights: projectRightOverridesSchema,
  alertKinds: alertKindsSchema,
};

/** A user as the API returns it. No hash field, so a route can't send one by mistake (ADR-0012). */
export const userSchema = z.object({
  id,
  email: z.string(),
  displayName: z.string(),
  roleId: id,
  disabled: z.boolean(),
  ...overrides,
  lastLoginAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const email = z.string().trim().toLowerCase().pipe(z.email());
/** The upper bound caps what scrypt has to chew on. */
const newPassword = z.string().min(8).max(256);

export const loginSchema = z.object({ email, password: z.string().min(1).max(256) });

const displayName = z.string().trim().min(1).max(100);

/** The first admin (`POST /api/auth/setup`). `token`: the one printed at boot, when not on loopback. */
export const setupSchema = z.object({
  email,
  displayName,
  password: newPassword,
  token: z.string().max(200).optional(),
});

/** An account added by a user manager (`POST /api/users`). Overrides left out: same as role. */
export const userCreateSchema = z.object({
  email,
  displayName,
  password: newPassword,
  roleId: id,
  permissions: permissionOverridesSchema.strict().optional(),
  projectRights: projectRightOverridesSchema.strict().optional(),
  alertKinds: alertKindsSchema.strict().optional(),
});

/** A user manager's edit; a new `password` is a reset, overrides replace the stored ones. */
export const userPatchSchema = userCreateSchema
  .extend({ disabled: z.boolean() })
  .partial()
  .strict();

/** Your own account (`PATCH /api/auth/me`). A new password needs the current one; `alertKinds` replaces your overrides. */
export const meUpdateSchema = z
  .object({
    displayName,
    currentPassword: z.string().max(256),
    password: newPassword,
    alertKinds: alertKindsSchema.strict(),
  })
  .partial()
  .strict()
  .refine((v) => !v.password || v.currentPassword, { path: ["currentPassword"] });

/** Where a user's notify alerts go (ADR-0016). The token never comes back, only whether one is set. */
export const deliverySchema = z.object({
  email: z.boolean(),
  /** null = the account email. */
  emailTo: z.string().nullable(),
  ntfyTopic: z.string().nullable(),
  ntfyTokenSet: z.boolean(),
});

/** `PUT .../delivery`. `ntfyToken` left out or empty keeps the stored one; null removes it. */
export const deliveryInputSchema = z
  .object({
    email: z.boolean(),
    emailTo: email.or(z.literal("")),
    ntfyTopic: z
      .string()
      .trim()
      .regex(/^[-\w]{0,64}$/),
    ntfyToken: z.string().trim().max(200).nullable(),
  })
  .partial()
  .strict();

/** `POST /api/auth/me/delivery/test`: one entry per destination tried. */
export const deliveryTestSchema = z.array(z.object({ channel: z.string(), ok: z.boolean() }));

/** `user` and `role` are null in the no-users mode, where everyone has the Admin role's rights. */
export const meSchema = z.object({
  user: userSchema.nullable(),
  role: z
    .object({
      id,
      name: z.string(),
      builtIn: z.enum(ROLE_BUILT_INS).nullable(),
      alertKinds: alertKindsSchema,
    })
    .nullable(),
  ...effectiveRightsSchema.shape,
});

export type User = z.infer<typeof userSchema>;
export type UserLoginInput = z.input<typeof loginSchema>;
export type SetupInput = z.input<typeof setupSchema>;
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserPatch = z.input<typeof userPatchSchema>;
export type MeUpdate = z.input<typeof meUpdateSchema>;
export type Me = z.infer<typeof meSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type DeliveryInput = z.input<typeof deliveryInputSchema>;
