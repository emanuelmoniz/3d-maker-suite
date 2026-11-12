import { BUILT_IN_ROLE_IDS, type User } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { KeyRound, Trash2, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMe, useRights } from "../../lib/auth.ts";
import { cx, textLink } from "../../lib/cx.ts";
import { formatDateTime } from "../../lib/format.ts";
import { mayAssign, useRoles, useUserActions, useUsers } from "../../lib/users.ts";

const ERRORS: Record<string, string> = {
  last_admin: "users:list.errors.last_admin",
  email_taken: "users:list.errors.email_taken",
  own_account: "users:list.errors.own_account",
  admin_only: "users:list.errors.admin_only",
  escalation: "users:list.errors.escalation",
};
const field = (f: FormData, k: string) => String(f.get(k) ?? "");

/** The message for a failed user or role change. */
export function useUserError() {
  const { t } = useTranslation();
  return (e: unknown) =>
    t(ERRORS[e instanceof ApiError ? (e.code ?? "") : ""] ?? "users:list.errors.generic");
}

/** New password and its repeat (the reset dialog compares them). */
function PasswordFields({ mismatch }: { mismatch: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <FormField label={t("users:fields.newPassword")} hint={t("users:fields.passwordHint")}>
        {(p) => (
          <input
            {...p}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={256}
            className={inputClass}
          />
        )}
      </FormField>
      <FormField
        label={t("users:fields.confirmPassword")}
        error={mismatch ? t("users:fields.mismatch") : undefined}
      >
        {(p) => (
          <input
            {...p}
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            className={inputClass}
          />
        )}
      </FormField>
    </>
  );
}

type Dialog = { kind: "add" } | { kind: "reset" | "delete"; user: User };

/** users.manage only. While no account exists it offers to create the first admin instead. */
export function UsersSection() {
  const { t } = useTranslation();
  const me = useMe();
  const own = useRights();
  const users = useUsers(!!me);
  const roleList = useRoles(!!me).data ?? [];
  const { create, patch, remove } = useUserActions();
  const errorText = useUserError();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [mismatch, setMismatch] = useState(false);

  if (!me)
    return (
      <>
        <p className="text-muted">{t("users:list.noAccounts")}</p>
        <Link to="/setup" className={textLink}>
          {t("users:list.createFirst")}
        </Link>
      </>
    );

  const roleOf = (id: string) => roleList.find((r) => r.id === id);
  // Only the Admin role changes Admin-role accounts or gives that role (ADR-0016).
  const adminRole = (id: string) => roleOf(id)?.builtIn === "admin";
  const mayChange = (u: User) => own?.admin || !adminRole(u.roleId);
  // Role names are the admins' own data, not UI strings.
  const roles = roleList
    .filter((r) => mayAssign(own, r))
    .map((r) => ({ value: r.id, label: r.name }));
  const close = () => {
    setDialog(null);
    setMismatch(false);
    for (const m of [create, patch, remove]) m.reset();
  };
  const failed = [create, patch, remove].find((m) => m.isError)?.error;
  const message = failed ? errorText(failed) : undefined;
  const icon = "size-4";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-muted">{t("users:list.hint")}</p>
        <Button variant="primary" onClick={() => setDialog({ kind: "add" })}>
          {t("users:list.add")}
        </Button>
      </div>
      {message && !dialog && (
        <p role="alert" className="text-bad">
          {message}
        </p>
      )}
      {users.data && (
        <DataTable
          label={t("users:list.label")}
          rows={users.data}
          rowKey={(u) => u.id}
          columns={[
            {
              id: "name",
              header: t("users:list.columns.name"),
              cell: (u) => (
                <span className="inline-flex items-center gap-2">
                  {mayChange(u) ? (
                    <Link to="/settings/users/$id" params={{ id: u.id }} className={textLink}>
                      {u.displayName}
                    </Link>
                  ) : (
                    <span className="font-medium">{u.displayName}</span>
                  )}
                  {u.id === me.id && <span className="text-muted">{t("users:list.you")}</span>}
                </span>
              ),
              sortValue: (u) => u.displayName.toLowerCase(),
              filterValue: (u) => u.displayName,
            },
            {
              id: "email",
              header: t("users:list.columns.email"),
              cell: (u) => u.email,
              sortValue: (u) => u.email,
              filterValue: (u) => u.email,
            },
            {
              id: "role",
              header: t("users:list.columns.role"),
              cell: (u) => {
                const r = roleOf(u.roleId);
                return r ? (
                  <Link to="/settings/roles/$id" params={{ id: r.id }} className={textLink}>
                    {r.name}
                  </Link>
                ) : null;
              },
              sortValue: (u) => roleOf(u.roleId)?.name ?? "",
              filterValue: (u) => u.roleId,
              filterOptions: roleList.map((r) => ({ value: r.id, label: r.name })),
            },
            {
              id: "state",
              header: t("users:list.columns.state"),
              cell: (u) => {
                const off = u.disabled || roleOf(u.roleId)?.disabled;
                return (
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cx("size-2 rounded-full", off ? "bg-bad" : "bg-ok")}
                    />
                    {u.disabled
                      ? t("users:list.disabled")
                      : off
                        ? t("users:list.roleDisabled")
                        : u.lastLoginAt
                          ? t("users:list.lastLogin", { when: formatDateTime(u.lastLoginAt) })
                          : t("users:list.neverLoggedIn")}
                  </span>
                );
              },
              sortValue: (u) => (u.disabled ? "" : (u.lastLoginAt ?? " ")),
            },
            {
              id: "actions",
              header: t("users:list.columns.actions"),
              cell: (u) =>
                mayChange(u) && (
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      aria-label={t("users:list.resetNamed", { name: u.displayName })}
                      title={t("users:list.reset")}
                      onClick={() => setDialog({ kind: "reset", user: u })}
                    >
                      <KeyRound className={icon} aria-hidden />
                    </Button>
                    {u.id !== me.id && (
                      <>
                        <Button
                          variant="ghost"
                          aria-label={t(
                            u.disabled ? "users:list.enableNamed" : "users:list.disableNamed",
                            { name: u.displayName },
                          )}
                          title={t(u.disabled ? "users:list.enable" : "users:list.disable")}
                          disabled={patch.isPending}
                          onClick={() => patch.mutate({ id: u.id, disabled: !u.disabled })}
                        >
                          {u.disabled ? (
                            <UserCheck className={icon} aria-hidden />
                          ) : (
                            <UserX className={icon} aria-hidden />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={t("users:list.deleteNamed", { name: u.displayName })}
                          title={t("users:list.delete")}
                          onClick={() => setDialog({ kind: "delete", user: u })}
                        >
                          <Trash2 className={cx(icon, "text-bad")} aria-hidden />
                        </Button>
                      </>
                    )}
                  </span>
                ),
            },
          ]}
        />
      )}

      <FormDialog
        open={dialog?.kind === "add"}
        title={t("users:list.add")}
        error={message}
        busy={create.isPending}
        onCancel={close}
        onSubmit={(f) =>
          create.mutate(
            {
              displayName: field(f, "displayName"),
              email: field(f, "email"),
              password: field(f, "password"),
              roleId: field(f, "roleId"),
            },
            { onSuccess: close },
          )
        }
      >
        <FormField label={t("users:fields.displayName")}>
          {(p) => (
            <input {...p} name="displayName" required maxLength={100} className={inputClass} />
          )}
        </FormField>
        <FormField label={t("users:fields.email")}>
          {(p) => <input {...p} name="email" type="email" required className={inputClass} />}
        </FormField>
        <FormField label={t("users:fields.newPassword")} hint={t("users:fields.passwordHint")}>
          {(p) => (
            <input
              {...p}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={256}
              className={inputClass}
            />
          )}
        </FormField>
        <FormField label={t("users:fields.role")}>
          {(p) => (
            <Combobox
              {...p}
              name="roleId"
              defaultValue={BUILT_IN_ROLE_IDS.viewer}
              options={roles}
              required
            />
          )}
        </FormField>
      </FormDialog>

      <FormDialog
        open={dialog?.kind === "reset"}
        title={t("users:list.resetTitle", {
          name: dialog?.kind === "reset" ? dialog.user.displayName : "",
        })}
        error={message}
        busy={patch.isPending}
        onCancel={close}
        onSubmit={(f) => {
          if (dialog?.kind !== "reset") return;
          const bad = field(f, "password") !== field(f, "confirm");
          setMismatch(bad);
          if (!bad)
            patch.mutate(
              { id: dialog.user.id, password: field(f, "password") },
              { onSuccess: close },
            );
        }}
      >
        <p className="text-muted">{t("users:list.resetHint")}</p>
        <PasswordFields mismatch={mismatch} />
      </FormDialog>

      <ConfirmDialog
        open={dialog?.kind === "delete"}
        destructive
        title={t("users:list.deleteTitle", {
          name: dialog?.kind === "delete" ? dialog.user.displayName : "",
        })}
        description={message ?? t("users:list.deleteBody")}
        confirmLabel={t("users:list.delete")}
        onCancel={close}
        onConfirm={() =>
          dialog?.kind === "delete" && remove.mutate(dialog.user.id, { onSuccess: close })
        }
      />
    </div>
  );
}
