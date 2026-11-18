import { useQuery } from "@tanstack/react-query";
import { meQuery } from "../lib/auth.ts";
import { RolesSection } from "./settings/RolesSection.tsx";
import { UsersSection } from "./settings/UsersSection.tsx";

/**
 * The Users and Roles tabs of Settings (`users.manage`, checked by `SettingsShell`); while no
 * account exists, only the first-admin offer.
 */
export function UsersPage({ tab }: { tab: "users" | "roles" }) {
  const me = useQuery(meQuery);
  if (!me.data) return null;
  return tab === "roles" && me.data.user ? <RolesSection /> : <UsersSection />;
}
