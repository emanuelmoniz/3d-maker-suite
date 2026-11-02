import type { Role } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { Switch } from "../../components/Switch.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMyRole } from "../../lib/auth.ts";
import { useRoleActions, useRoles } from "../../lib/users.ts";

const ROLE_ERRORS: Record<string, string> = {
  role_in_use: "users:roles.errors.role_in_use",
  name_taken: "users:roles.errors.name_taken",
  role_builtin: "users:roles.errors.role_builtin",
  escalation: "users:list.errors.escalation",
};

export function useRoleError() {
  const { t } = useTranslation();
  return (e: unknown) =>
    t(ROLE_ERRORS[e instanceof ApiError ? (e.code ?? "") : ""] ?? "users:list.errors.generic");
}

/** The roles (ADR-0016): users.manage only. The Admin role is listed but fixed. */
export function RolesSection() {
  const { t } = useTranslation();
  const roles = useRoles(true);
  const mine = useMyRole();
  const { patch, remove } = useRoleActions();
  const errorText = useRoleError();
  const [deleting, setDeleting] = useState<Role | null>(null);
  const failed = [patch, remove].find((m) => m.isError)?.error;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-muted">{t("users:roles.hint")}</p>
        <Link
          to="/settings/roles/new"
          className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden />
          {t("users:roles.add")}
        </Link>
      </div>
      {failed && !deleting && (
        <p role="alert" className="text-bad">
          {errorText(failed)}
        </p>
      )}
      {roles.data && (
        <DataTable
          label={t("users:roles.label")}
          rows={roles.data}
          rowKey={(r) => r.id}
          columns={[
            {
              id: "name",
              header: t("users:roles.columns.name"),
              cell: (r) => (
                <span className="inline-flex items-center gap-2">
                  <Link
                    to="/settings/roles/$id"
                    params={{ id: r.id }}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  {r.builtIn && (
                    <span className="rounded-sm bg-surface-2 px-1.5 text-xs text-muted">
                      {t("users:roles.builtIn")}
                    </span>
                  )}
                </span>
              ),
              sortValue: (r) => r.name.toLowerCase(),
              filterValue: (r) => r.name,
            },
            {
              id: "users",
              header: t("users:roles.columns.users"),
              numeric: true,
              cell: (r) => r.usersCount,
              sortValue: (r) => r.usersCount,
              filterValue: (r) => r.usersCount,
            },
            {
              id: "enabled",
              header: t("users:roles.columns.enabled"),
              // The Admin role and your own can't be switched off.
              cell: (r) =>
                r.builtIn === "admin" || r.id === mine?.id ? (
                  <span className="text-muted">{t("users:roles.alwaysOn")}</span>
                ) : (
                  <Switch
                    label=""
                    aria-label={t("users:roles.enabledNamed", { name: r.name })}
                    checked={!r.disabled}
                    disabled={patch.isPending}
                    onChange={(e) => patch.mutate({ id: r.id, disabled: !e.target.checked })}
                  />
                ),
              filterValue: (r) => (r.disabled ? "disabled" : "enabled"),
              filterOptions: [
                { value: "enabled", label: t("users:roles.states.enabled") },
                { value: "disabled", label: t("users:roles.states.disabled") },
              ],
            },
            {
              id: "actions",
              header: t("users:roles.columns.actions"),
              cell: (r) =>
                r.builtIn !== "admin" && (
                  <Button
                    variant="ghost"
                    aria-label={t("users:roles.deleteNamed", { name: r.name })}
                    title={t("users:roles.delete")}
                    onClick={() => {
                      remove.reset();
                      setDeleting(r);
                    }}
                  >
                    <Trash2 className="size-4 text-bad" aria-hidden />
                  </Button>
                ),
            },
          ]}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        destructive
        title={t("users:roles.deleteTitle", { name: deleting?.name ?? "" })}
        description={
          remove.isError
            ? errorText(remove.error)
            : deleting?.usersCount
              ? t("users:roles.deleteInUse", { count: deleting.usersCount })
              : t("users:roles.deleteBody")
        }
        confirmLabel={t("users:roles.delete")}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      />
    </div>
  );
}
