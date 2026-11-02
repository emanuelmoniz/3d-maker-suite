import type { Permission, PermissionLevel } from "@3d-maker-suite/core";
import type { ReactNode } from "react";
import { useCan } from "../lib/auth.ts";

/**
 * Shows its children only to users with the permission (`level` for a module, write by default),
 * and only `when` that one thing may change (a project's `canEdit`). The server enforces the same;
 * this hides dead buttons.
 */
export function Write({
  children,
  can,
  level,
  when = true,
}: {
  children: ReactNode;
  can: Permission;
  level?: PermissionLevel;
  when?: boolean;
}) {
  return useCan(can, level) && when ? children : null;
}
