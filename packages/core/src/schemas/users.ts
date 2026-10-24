import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { USER_ROLES } from "./enums.ts";

export const userRoleSchema = z.enum(USER_ROLES);

/** A user as the API returns it. No hash field, so a route can't send one by mistake (ADR-0012). */
export const userSchema = z.object({
  id,
  email: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  disabled: z.boolean(),
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

/** An account added by an admin (`POST /api/users`). */
export const userCreateSchema = z.object({
  email,
  displayName,
  password: newPassword,
  role: userRoleSchema,
});

/** Admin edit; a new `password` is a reset. */
export const userPatchSchema = userCreateSchema
  .extend({ disabled: z.boolean() })
  .partial()
  .strict();

/** Your own account (`PATCH /api/auth/me`). A new password needs the current one. */
export const meUpdateSchema = z
  .object({ displayName, currentPassword: z.string().max(256), password: newPassword })
  .partial()
  .strict()
  .refine((v) => !v.password || v.currentPassword, { path: ["currentPassword"] });

export const meSchema = z.object({ user: userSchema.nullable() });

export type UserRole = z.infer<typeof userRoleSchema>;
export type User = z.infer<typeof userSchema>;
export type UserLoginInput = z.input<typeof loginSchema>;
export type SetupInput = z.input<typeof setupSchema>;
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserPatch = z.input<typeof userPatchSchema>;
export type MeUpdate = z.input<typeof meUpdateSchema>;
export type Me = z.infer<typeof meSchema>;
