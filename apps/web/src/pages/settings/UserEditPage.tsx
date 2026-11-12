import { ADMIN_EFFECTIVE, effectiveRights, type Role, type User } from "@3d-maker-suite/core";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useMe, useRights } from "../../lib/auth.ts";
import { mayAssign, useRoles, useUserActions, useUsers } from "../../lib/users.ts";
import { AlertKindsEditor } from "./AlertKindsEditor.tsx";
import { RightsEditor, same } from "./RightsEditor.tsx";
import { SaveBar } from "./RoleEditPage.tsx";
import { useUserError } from "./UsersSection.tsx";

type Draft = Pick<
  User,
  "displayName" | "email" | "roleId" | "disabled" | "permissions" | "projectRights" | "alertKinds"
>;

/** The one override an Admin-role user takes (ADR-0016). */
const ADMIN_KEY = "projects.editOtherDevices";

function UserForm({ user, roles }: { user: User; roles: Role[] }) {
  const { t } = useTranslation();
  const me = useMe();
  const own = useRights();
  const { patch } = useUserActions();
  const errorText = useUserError();
  const initial: Draft = {
    displayName: user.displayName,
    email: user.email,
    roleId: user.roleId,
    disabled: user.disabled,
    permissions: user.permissions,
    projectRights: user.projectRights,
    alertKinds: user.alertKinds,
  };
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const role = roles.find((r) => r.id === draft.roleId);
  const isAdminRole = role?.builtIn === "admin";
  const self = user.id === me?.id;
  // Only the Admin role changes Admin-role accounts (the server says the same).
  const locked = !own?.admin && roles.find((r) => r.id === user.roleId)?.builtIn === "admin";
  const dirty = !same(draft, initial);
  // An Admin-role user takes only the device files override; the rest would be refused.
  const overrides = isAdminRole
    ? {
        permissions: {},
        projectRights: Object.fromEntries(
          Object.entries(draft.projectRights).filter(([k]) => k === ADMIN_KEY),
        ),
      }
    : draft;
  // Role names are the admins' own data, not UI strings.
  const options = roles
    .filter((r) => r.id === user.roleId || mayAssign(own, r))
    .map((r) => ({ value: r.id, label: r.name }));

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        patch.mutate(
          {
            id: user.id,
            ...draft,
            permissions: overrides.permissions,
            projectRights: overrides.projectRights,
          },
          { onSuccess: () => setSaved(true) },
        );
      }}
    >
      {locked && <p className="text-muted">{t("users:edit.adminOnly")}</p>}
      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 sm:p-5">
        <FormField label={t("users:fields.displayName")}>
          {(p) => (
            <input
              {...p}
              required
              maxLength={100}
              disabled={locked}
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              className={inputClass}
            />
          )}
        </FormField>
        <FormField label={t("users:fields.email")}>
          {(p) => (
            <input
              {...p}
              type="email"
              required
              disabled={locked}
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              className={inputClass}
            />
          )}
        </FormField>
        <FormField
          label={t("users:fields.role")}
          hint={self ? t("users:edit.ownAccount") : undefined}
        >
          {(p) => (
            <Combobox
              {...p}
              value={draft.roleId}
              disabled={locked || self}
              options={options}
              onChange={(roleId) => setDraft({ ...draft, roleId })}
            />
          )}
        </FormField>
        {!self && (
          <div className="self-end">
            <Switch
              label={t("users:edit.enabled")}
              checked={!draft.disabled}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, disabled: !e.target.checked })}
            />
            <p className="text-muted">{t("users:edit.enabledHint")}</p>
          </div>
        )}
      </section>
      <p className="text-muted">
        {isAdminRole ? t("users:edit.adminRights") : t("users:edit.rightsHint")}
      </p>
      {role && (
        <RightsEditor
          base={isAdminRole ? ADMIN_EFFECTIVE : role}
          overrides={overrides}
          own={own}
          disabled={locked || self}
          editable={(key) => !isAdminRole || key === ADMIN_KEY}
          onChange={(group, key, v) => {
            const next = { ...draft[group] } as Record<string, unknown>;
            if (v === undefined) delete next[key];
            else next[key] = v;
            setDraft({ ...draft, [group]: next });
          }}
        />
      )}
      {role && (
        <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-1 text-base font-semibold">{t("users:alerts.title")}</h2>
          <p className="mb-3 text-muted">
            {self ? t("users:alerts.ownAccount") : t("users:alerts.userHint")}
          </p>
          <AlertKindsEditor
            permissions={effectiveRights(role, overrides).permissions}
            value={draft.alertKinds}
            role={role.alertKinds}
            disabled={locked || self}
            onChange={(alertKinds) => setDraft({ ...draft, alertKinds })}
          />
        </section>
      )}
      {!locked && (
        <SaveBar
          dirty={dirty}
          busy={patch.isPending}
          status={
            patch.isError ? (
              <span className="text-bad">{errorText(patch.error)}</span>
            ) : saved && !dirty ? (
              t("users:edit.saved")
            ) : undefined
          }
        />
      )}
    </form>
  );
}

/** One account: name, email, role, state and overrides on the role (users.manage only). */
export function UserEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const users = useUsers(true);
  const roles = useRoles(true);
  const user = users.data?.find((u) => u.id === id);

  return (
    <>
      <PageHeader
        title={user?.displayName ?? t("users:edit.titleFallback")}
        description={user?.email}
        backTo={{ to: "/users" }}
      />
      {(users.isError || roles.isError) && (
        <p role="alert" className="text-bad">
          {t("users:list.errors.generic")}
        </p>
      )}
      {users.data && !user && <p className="text-muted">{t("users:edit.notFound")}</p>}
      {user && roles.data && <UserForm key={user.id} user={user} roles={roles.data} />}
    </>
  );
}
