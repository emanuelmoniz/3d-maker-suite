import type { ReactNode } from "react";
import { useCan } from "../lib/auth.ts";

/** Shows its children only to roles that may change data. The server enforces the same; this hides dead buttons. */
export function Write({ children }: { children: ReactNode }) {
  return useCan("write") ? children : null;
}
