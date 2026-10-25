import type { ReactNode } from "react";
import { useCan } from "../lib/auth.ts";

/** Shows its children only to roles that may change data (`admin`: admins only). The server enforces the same; this hides dead buttons. */
export function Write({ children, admin }: { children: ReactNode; admin?: boolean }) {
  return useCan(admin ? "admin" : "write") ? children : null;
}
