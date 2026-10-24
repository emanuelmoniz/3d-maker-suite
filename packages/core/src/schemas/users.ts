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

/** The first admin (`POST /api/auth/setup`). */
export const setupSchema = z.object({
  email,
  displayName: z.string().trim().min(1),
  password: newPassword,
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type User = z.infer<typeof userSchema>;
export type UserLoginInput = z.input<typeof loginSchema>;
export type SetupInput = z.input<typeof setupSchema>;
