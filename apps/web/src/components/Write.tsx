import type { ReactNode } from "react";
import { useCan } from "../lib/auth.ts";

/**
 * Shows its children only to roles that may change data (`admin`: admins only), and only `when`
 * that one thing may change (a project's `canEdit`). The server enforces the same; this hides dead buttons.
 */
export function Write({
  children,
  admin,
  when = true,
}: {
  children: ReactNode;
  admin?: boolean;
  when?: boolean;
}) {
  return useCan(admin ? "admin" : "write") && when ? children : null;
}
