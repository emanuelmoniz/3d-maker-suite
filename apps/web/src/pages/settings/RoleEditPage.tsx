import { BUILT_IN_RIGHTS, BUILT_IN_ROLE_IDS, type Role } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useMyRole, useRights } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import { useRoleActions, useRoles } from "../../lib/users.ts";
import { type Rights, RightsEditor, same } from "./RightsEditor.tsx";
import { useRoleError } from "./RolesSection.tsx";

/**
 * The bottom of a long rights form: says whether anything is unsaved, and while something is, stays
 * in view (above the mobile tab bar).
 */
export function SaveBar({
  dirty,
  busy,
  status,
  children,
}: {
  dirty: boolean;
  busy: boolean;
  status?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cx(
        "z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3",
        dirty && "sticky bottom-16 shadow-lg md:bottom-4",
      )}
    >
      <span role="status" className="min-w-0 flex-1 text-muted">
        {status ?? (dirty ? t("users:edit.unsaved") : t("users:edit.noChanges"))}
      </span>
      {children}
      <Button type="submit" variant="primary" disabled={!dirty || busy}>
        {t("common:actions.save")}
      </Button>
    </div>
  );
}

type Draft = Rights & { name: string; disabled: boolean };

function RoleForm({ role, roles }: { role: Role | null; roles: Role[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const own = useRights();
  const mine = useMyRole();
  const { create, patch } = useRoleActions();
  const errorText = useRoleError();
  const initial: Draft = role
    ? {
        name: role.name,
        disabled: role.disabled,
        permissions: role.permissions,
        projectRights: role.projectRights,
      }
    : { name: "", disabled: false, ...BUILT_IN_RIGHTS.viewer };
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const fixed = role?.builtIn === "admin";
  const dirty = !same(draft, initial);
  const save = role ? patch : create;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        if (role) patch.mutate({ id: role.id, ...draft }, { onSuccess: () => setSaved(true) });
        else
          create.mutate(draft, {
            onSuccess: (r) =>
              navigate({ to: "/settings/roles/$id", params: { id: r.id }, replace: true }),
          });
      }}
    >
      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 sm:p-5">
        <FormField label={t("users:roles.fields.name")}>
          {(p) => (
            <input
              {...p}
              required
              maxLength={100}
              disabled={fixed}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={inputClass}
            />
          )}
        </FormField>
        {!role && (
          <FormField
            label={t("users:roles.fields.copyFrom")}
            hint={t("users:roles.fields.copyHint")}
          >
            {(p) => (
              <Combobox
                {...p}
                defaultValue={BUILT_IN_ROLE_IDS.viewer}
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
                onChange={(id) => {
                  const from = roles.find((r) => r.id === id);
                  if (from)
                    setDraft({
                      ...draft,
                      permissions: from.permissions,
                      projectRights: from.projectRights,
                    });
                }}
              />
            )}
          </FormField>
        )}
        {!fixed && role?.id !== mine?.id && (
          <div className="sm:col-span-2">
            <Switch
              label={t("users:roles.fields.enabled")}
              checked={!draft.disabled}
              onChange={(e) => setDraft({ ...draft, disabled: !e.target.checked })}
            />
            <p className="text-muted">{t("users:roles.fields.enabledHint")}</p>
          </div>
        )}
        {fixed && <p className="text-muted sm:col-span-2">{t("users:roles.adminFixed")}</p>}
      </section>
      <RightsEditor
        base={draft}
        own={own}
        disabled={fixed}
        onChange={(group, key, v) => setDraft({ ...draft, [group]: { ...draft[group], [key]: v } })}
      />
      {!fixed && (
        <SaveBar
          dirty={dirty}
          busy={save.isPending}
          status={
            save.isError ? (
              <span className="text-bad">{errorText(save.error)}</span>
            ) : saved && !dirty ? (
              t("users:edit.saved")
            ) : undefined
          }
        />
      )}
    </form>
  );
}

/** A role's name, state and rights (users.manage only); `/settings/roles/new` adds one. */
export function RoleEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id?: string };
  const roles = useRoles(true);
  const role = id ? roles.data?.find((r) => r.id === id) : null;
  const title = role ? role.name : id ? t("users:roles.titleFallback") : t("users:roles.add");

  return (
    <>
      <PageHeader title={title} backTo={{ to: "/settings" }} />
      {roles.isError && (
        <p role="alert" className="text-bad">
          {t("users:list.errors.generic")}
        </p>
      )}
      {roles.data && role === undefined && (
        <p className="text-muted">{t("users:roles.notFound")}</p>
      )}
      {roles.data && role !== undefined && (
        // Re-mounted per role, so the form starts from what is stored.
        <RoleForm key={role?.id ?? "new"} role={role} roles={roles.data} />
      )}
    </>
  );
}
