import { USER_ROLES, type User, type UserRole } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMe } from "../../lib/auth.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useUserActions, useUsers } from "../../lib/users.ts";

// Keys written out in full so `pnpm i18n:check` can see them.
const ROLE_LABELS = {
  admin: "common:userMenu.roles.admin",
  editor: "common:userMenu.roles.editor",
  viewer: "common:userMenu.roles.viewer",
} as const;
const ERRORS: Record<string, string> = {
  last_admin: "users:list.errors.last_admin",
  email_taken: "users:list.errors.email_taken",
};
const field = (f: FormData, k: string) => String(f.get(k) ?? "");

type Dialog = { kind: "add" } | { kind: "reset" | "delete"; user: User };

/** Admin only. While no account exists it offers to create the first admin instead. */
export function UsersSection() {
  const { t } = useTranslation();
  const me = useMe();
  const users = useUsers(!!me);
  const { create, patch, remove } = useUserActions();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [mismatch, setMismatch] = useState(false);

  if (!me)
    return (
      <>
        <p className="text-muted">{t("users:list.noAccounts")}</p>
        <Link to="/setup" className="font-medium text-accent hover:underline">
          {t("users:list.createFirst")}
        </Link>
      </>
    );

  const roles = USER_ROLES.map((r) => ({ value: r, label: t(ROLE_LABELS[r]) }));
  const close = () => {
    setDialog(null);
    setMismatch(false);
    for (const m of [create, patch, remove]) m.reset();
  };
  const failed = [create, patch, remove].find((m) => m.isError)?.error;
  const message = failed
    ? t(
        ERRORS[failed instanceof ApiError ? (failed.code ?? "") : ""] ??
          "users:list.errors.generic",
      )
    : undefined;
  const passwordInput = (p: object) => (
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
  );

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
      <ul aria-label={t("users:list.label")} className="grid gap-2">
        {users.data?.map((u) => (
          <li
            key={u.id}
            className="grid gap-3 rounded-md border border-border p-3 lg:grid-cols-[1fr_auto] lg:items-center"
          >
            <div className="min-w-0">
              <p className="font-medium wrap-anywhere">
                {u.displayName}
                {u.id === me.id && <span className="ml-2 text-muted">{t("users:list.you")}</span>}
                {u.disabled && <span className="ml-2 text-bad">{t("users:list.disabled")}</span>}
              </p>
              <p className="text-muted wrap-anywhere">{u.email}</p>
              <p className="text-muted">
                {u.lastLoginAt
                  ? t("users:list.lastLogin", { when: formatDateTime(u.lastLoginAt) })
                  : t("users:list.neverLoggedIn")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Combobox
                aria-label={t("users:list.roleOf", { name: u.displayName })}
                className={`${inputClass} w-36`}
                value={u.role}
                options={roles}
                onChange={(role) => patch.mutate({ id: u.id, role: role as UserRole })}
              />
              <Button onClick={() => patch.mutate({ id: u.id, disabled: !u.disabled })}>
                {t(u.disabled ? "users:list.enable" : "users:list.disable")}
              </Button>
              <Button onClick={() => setDialog({ kind: "reset", user: u })}>
                {t("users:list.reset")}
              </Button>
              <Button variant="danger" onClick={() => setDialog({ kind: "delete", user: u })}>
                {t("users:list.delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

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
              role: field(f, "role") as UserRole,
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
          {passwordInput}
        </FormField>
        <FormField label={t("users:fields.role")}>
          {(p) => <Combobox {...p} name="role" defaultValue="viewer" options={roles} required />}
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
        <FormField label={t("users:fields.newPassword")} hint={t("users:fields.passwordHint")}>
          {passwordInput}
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
