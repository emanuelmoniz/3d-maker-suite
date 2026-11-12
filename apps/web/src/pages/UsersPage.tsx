import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { meQuery } from "../lib/auth.ts";
import { useUsersShown } from "../lib/users.ts";
import { RolesSection } from "./settings/RolesSection.tsx";
import { UsersSection } from "./settings/UsersSection.tsx";

/** Users and Roles tabs. Needs `users.manage`; while no account exists, only the first-admin offer. */
export function UsersPage({ tab }: { tab: "users" | "roles" }) {
  const { t } = useTranslation();
  const allowed = useUsersShown();
  const me = useQuery(meQuery);
  if (!me.data) return null;
  if (!allowed) return <Navigate to="/" replace />;
  const signedIn = !!me.data.user;
  return (
    <>
      <PageHeader
        title={t("nav:items.users.label")}
        description={t("nav:items.users.description")}
      />
      {signedIn && (
        <Tabs
          label={t("users:tabs.label")}
          items={[
            { to: "/users", label: t("users:list.title"), exact: true },
            { to: "/users/roles", label: t("users:roles.title") },
          ]}
        />
      )}
      {tab === "roles" && signedIn ? <RolesSection /> : <UsersSection />}
    </>
  );
}
