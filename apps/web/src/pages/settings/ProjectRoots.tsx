import {
  ROOT_DEFAULTS,
  ROOT_EDIT_BY,
  ROOT_HUB,
  type Root,
  type RootPatch,
  type User,
} from "@3d-maker-suite/core";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { RootStateBadge } from "../../components/RootStateBadge.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMe } from "../../lib/auth.ts";
import { formatNumber } from "../../lib/format.ts";
import { useDevices } from "../../lib/hub.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useChangeRoot, useRoots } from "../../lib/roots.ts";
import { useUsers } from "../../lib/users.ts";

type Depths = Pick<Root, "projectDepth" | "filesDepth">;
const PROJECT_DEPTHS = [1, 2, 3, 4, 5];
const FILES_DEPTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** The project and files depth of one root (`path`), or of the root being added. */
function DepthFields({
  value,
  path,
  onChange,
}: {
  value: Depths;
  path?: string;
  onChange: (d: Depths) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="flex items-center gap-2">
        <span aria-hidden>{t("settings:projects.projectDepth")}</span>
        <select
          className={`${inputClass} w-auto!`}
          aria-label={
            path
              ? t("settings:projects.projectDepthFor", { path })
              : t("settings:projects.projectDepth")
          }
          value={value.projectDepth}
          onChange={(e) => onChange({ ...value, projectDepth: Number(e.target.value) })}
        >
          {PROJECT_DEPTHS.map((n) => (
            <option key={n} value={n}>
              {formatNumber(n)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span aria-hidden>{t("settings:projects.filesDepth")}</span>
        <select
          className={`${inputClass} w-auto!`}
          aria-label={
            path
              ? t("settings:projects.filesDepthFor", { path })
              : t("settings:projects.filesDepth")
          }
          value={value.filesDepth ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              filesDepth: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        >
          <option value="">{t("settings:projects.filesDepthAll")}</option>
          {FILES_DEPTHS.map((n) => (
            <option key={n} value={n}>
              {formatNumber(n)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

const ROOT_ERRORS = {
  root_in_use: "settings:projects.rootInUse",
  root_exists: "settings:projects.rootExists",
  root_nested: "settings:projects.rootNested",
  path_denied: "settings:projects.rootNotShared",
  device_offline: "settings:projects.deviceOffline",
  device_timeout: "settings:projects.deviceTimeout",
} as const;

const EDIT_BY: Record<(typeof ROOT_EDIT_BY)[number], string> = {
  roles: "settings:projects.editBy.roles",
  admins: "settings:projects.editBy.admins",
  users: "settings:projects.editBy.users",
  none: "settings:projects.editBy.none",
};

/** Who edits a root's files (ADR-0014); "users" lists the editors and admins to pick. */
function EditBy({
  root,
  users,
  onChange,
}: {
  root: Root;
  users: User[];
  onChange: (patch: RootPatch) => void;
}) {
  const { t } = useTranslation();
  const picked = new Set(root.editorIds);
  return (
    <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1">
      <label className="flex items-center gap-2">
        <span>{t("settings:projects.editByLabel")}</span>
        <select
          className={`${inputClass} w-auto!`}
          value={root.editBy}
          aria-label={t("settings:projects.editByFor", { path: root.path })}
          onChange={(e) => onChange({ editBy: e.target.value as Root["editBy"] })}
        >
          {ROOT_EDIT_BY.map((v) => (
            <option key={v} value={v}>
              {t(EDIT_BY[v])}
            </option>
          ))}
        </select>
      </label>
      {root.editBy === "users" && (
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="sr-only">
            {t("settings:projects.editorsFor", { path: root.path })}
          </legend>
          {users.map((u) => (
            <label key={u.id} className="flex min-h-9 items-center gap-2">
              <input
                type="checkbox"
                checked={picked.has(u.id)}
                onChange={(e) =>
                  onChange({
                    editorIds: e.target.checked
                      ? [...picked, u.id]
                      : [...picked].filter((id) => id !== u.id),
                  })
                }
              />
              {u.displayName}
            </label>
          ))}
        </fieldset>
      )}
      {root.location !== ROOT_HUB && (
        <span className="text-muted">{t("settings:projects.editByDevice")}</span>
      )}
    </div>
  );
}

/**
 * The project folder roots, each with its depths, auto slice switch and a remove button. With the
 * hub on, a new root can be a folder on an online device (ADR-0014).
 */
export function ProjectRoots() {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const [depths, setDepths] = useState<Depths>(ROOT_DEFAULTS);
  const [location, setLocation] = useState(ROOT_HUB);
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  const devices = useDevices();
  const online = hubOn ? (devices.data ?? []).filter((d) => d.online) : [];
  const device = location === ROOT_HUB ? undefined : location;
  const roots = useRoots();
  // Users who can be picked to edit a root; the server refuses anyone without projects write.
  const editors = useUsers(!!useMe()).data ?? [];
  const save = useChangeRoot();
  const code = save.error instanceof ApiError ? save.error.code : undefined;
  const add = (dir: string) => {
    const d = dir.trim();
    if (d && !roots.some((r) => r.path === d && r.location === location))
      save.mutate({ add: { path: d, location, ...depths } });
  };
  const change = (id: string, patch: RootPatch) => save.mutate({ id, patch });
  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{t("settings:projects.roots")}</legend>
      <p className="text-muted">{t("settings:projects.rootsHint")}</p>
      {roots.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {roots.map((r) => (
            <li key={r.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 pr-1 pl-3">
              <span className="flex min-w-0 basis-full flex-wrap items-center gap-2 sm:flex-1 sm:basis-auto">
                <span className="break-all">{r.path}</span>
                {r.deviceName && (
                  <span className="text-muted">
                    {t("settings:projects.rootOn", { device: r.deviceName })}
                  </span>
                )}
                <RootStateBadge state={r.state} />
              </span>
              <DepthFields
                value={r}
                path={r.path}
                onChange={({ projectDepth, filesDepth }) =>
                  change(r.id, { projectDepth, filesDepth })
                }
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.autoSlice}
                  aria-label={t("settings:projects.autoSliceFor", { path: r.path })}
                  onChange={(e) => change(r.id, { autoSlice: e.target.checked })}
                />
                <span aria-hidden>{t("settings:projects.autoSlice")}</span>
              </label>
              <EditBy root={r} users={editors} onChange={(patch) => change(r.id, patch)} />
              <Button
                variant="ghost"
                aria-label={t("settings:projects.removeRoot", { path: r.path })}
                onClick={() => save.mutate({ remove: r.id })}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(typed);
          setTyped("");
        }}
      >
        {online.length > 0 && (
          <label className="flex basis-full items-center gap-2">
            <span>{t("settings:projects.location")}</span>
            <select
              className={`${inputClass} w-auto!`}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              aria-describedby="root-location-hint"
            >
              <option value={ROOT_HUB}>{t("settings:projects.locationHub")}</option>
              {online.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <span id="root-location-hint" className="text-muted">
              {t("settings:projects.locationHint")}
            </span>
          </label>
        )}
        <input
          className={`${inputClass} min-w-0 basis-full sm:flex-1 sm:basis-auto`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={t("settings:projects.newRoot")}
          placeholder={t("settings:projects.newRoot")}
        />
        <DepthFields value={depths} onChange={setDepths} />
        <Button type="submit" disabled={!typed.trim()}>
          {t("settings:projects.addRoot")}
        </Button>
        <PathPicker
          key={location}
          label={t("settings:projects.roots")}
          mode="folder"
          canCreate={!device}
          device={device}
          initial={roots.findLast((r) => r.location === location)?.path}
          onPick={add}
        />
      </form>
      {save.isError && (
        <p role="alert" className="text-bad">
          {t(
            code === "invalid_folder"
              ? device
                ? "settings:projects.rootMissingDevice"
                : "settings:projects.rootMissing"
              : code && code in ROOT_ERRORS
                ? ROOT_ERRORS[code as keyof typeof ROOT_ERRORS]
                : "settings:saveError",
          )}
        </p>
      )}
      <div className="grid gap-2 text-muted lg:grid-cols-3 lg:gap-6">
        <p>{t("settings:projects.projectDepthHint")}</p>
        <p>{t("settings:projects.filesDepthHint")}</p>
        <p>{t("settings:projects.autoSliceHint")}</p>
      </div>
    </fieldset>
  );
}
