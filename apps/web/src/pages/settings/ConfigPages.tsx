import {
  DEVICE_FOLDER_MAX_MB_LIMIT,
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
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { RootStateBadge } from "../../components/RootStateBadge.tsx";
import { Section } from "../../components/Section.tsx";
import { Switch } from "../../components/Switch.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMe } from "../../lib/auth.ts";
import { formatMegabytes, formatNumber } from "../../lib/format.ts";
import { useDevices } from "../../lib/hub.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { usePrinters } from "../../lib/printers.ts";
import { useEmptyProjectTrash, useProjectTrash } from "../../lib/projects.ts";
import { useChangeRoot, useRoots } from "../../lib/roots.ts";
import { useUsers } from "../../lib/users.ts";
import { ChannelsSection } from "../alerts/ChannelsSection.tsx";
import { FilamentCatalog, FilamentProfiles } from "../filament/Catalog.tsx";
import { Catalog } from "../printers/Catalog.tsx";
import { type ConfigCtx, ConfigPage } from "./ConfigPage.tsx";

type BoolKey =
  | "printerCountInCosts"
  | "includeMaintenanceCost"
  | "accessoryIncludeMaintenanceCost"
  | "accessoryCountInCosts";

export function CostsConfigPage() {
  const { t } = useTranslation();
  const check = ({ v, commit }: ConfigCtx, key: BoolKey, label: string, hint: string) => (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => commit({ [key]: e.target.checked })}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <ConfigPage module="quotes">
      {(ctx) => {
        const { v, commit, num } = ctx;
        return (
          <>
            <Section title={t("settings:sections.costs")}>
              <FormField
                label={t("settings:costs.currency")}
                hint={t("settings:costs.currencyHint")}
              >
                {(p) => (
                  <input
                    {...p}
                    className={inputClass}
                    key={`cur-${v.currency}`}
                    defaultValue={v.currency}
                    maxLength={3}
                    onBlur={(e) => {
                      const c = e.target.value.trim().toUpperCase();
                      if (/^[A-Z]{3}$/.test(c) && c !== v.currency) commit({ currency: c });
                      else e.target.value = v.currency;
                    }}
                  />
                )}
              </FormField>
              <FormField label={t("settings:costs.energyCost")}>
                {(p) => num("energyCostPerKwh", p)}
              </FormField>
              <FormField label={t("settings:costs.laborRate")}>
                {(p) => num("laborRatePerHour", p)}
              </FormField>
              <FormField label={t("settings:costs.failureMargin")}>
                {(p) => num("failureMarginPct", p)}
              </FormField>
              <FormField label={t("settings:costs.markup")}>{(p) => num("markupPct", p)}</FormField>
            </Section>
            <Section title={t("settings:costs.printers")}>
              {check(
                ctx,
                "printerCountInCosts",
                t("settings:costs.printerCount"),
                t("settings:costs.printerCountHint"),
              )}
              <FormField
                label={t("settings:costs.lifetime")}
                hint={t("settings:costs.lifetimeHint")}
              >
                {(p) => num("printerLifetimeHours", p)}
              </FormField>
              {check(
                ctx,
                "includeMaintenanceCost",
                t("settings:costs.maintenance"),
                t("settings:costs.maintenanceHint"),
              )}
            </Section>
            <Section title={t("settings:costs.accessories")}>
              {check(
                ctx,
                "accessoryCountInCosts",
                t("settings:costs.accessoryCount"),
                t("settings:costs.accessoryCountHint"),
              )}
              <FormField
                label={t("settings:costs.accessoryLifetime")}
                hint={t("settings:costs.accessoryLifetimeHint")}
              >
                {(p) => num("accessoryLifetimeHours", p)}
              </FormField>
              {check(
                ctx,
                "accessoryIncludeMaintenanceCost",
                t("settings:costs.maintenance"),
                t("settings:costs.accessoryMaintenanceHint"),
              )}
            </Section>
          </>
        );
      }}
    </ConfigPage>
  );
}

export function PrintsConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="prints">
      {({ v, commit, num }) => {
        const reasons = v.failureReasons.join("\n");
        return (
          <Section title={t("settings:sections.prints")}>
            <FormField label={t("settings:prints.pace")} hint={t("settings:prints.paceHint")}>
              {(p) => num("gramsPerHour", p)}
            </FormField>
            <FormField label={t("settings:prints.label")} hint={t("settings:prints.hint")}>
              {(p) => (
                <textarea
                  {...p}
                  className={`${inputClass} h-24 py-2`}
                  key={`reasons-${reasons}`}
                  defaultValue={reasons}
                  onBlur={(e) => {
                    const next = [
                      ...new Set(
                        e.target.value
                          .split(/\r?\n/)
                          .map((l) => l.trim())
                          .filter(Boolean),
                      ),
                    ];
                    if (next.join("|") !== v.failureReasons.join("|"))
                      commit({ failureReasons: next });
                  }}
                />
              )}
            </FormField>
          </Section>
        );
      }}
    </ConfigPage>
  );
}

export function ProjectsConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="projects">
      {({ num }) => (
        <Section title={t("settings:sections.projects")} wide help="docs/projects.md">
          <ProjectRoots />
          {/* The usual narrow column of a settings card; only the roots use the full width. */}
          <div className="grid gap-4 sm:max-w-md">
            <FormField
              label={t("settings:projects.maxFiles")}
              hint={t("settings:projects.maxFilesHint")}
            >
              {(p) => num("projectScanMaxFiles", p)}
            </FormField>
            <FormField
              label={t("settings:projects.deviceFolderMax")}
              hint={t("settings:projects.deviceFolderMaxHint", { max: DEVICE_FOLDER_MAX_MB_LIMIT })}
            >
              {(p) => num("deviceFolderMaxMb", p)}
            </FormField>
            <FormField
              label={t("settings:projects.viewerMax")}
              hint={t("settings:projects.viewerMaxHint")}
            >
              {(p) => num("viewerMaxMb", p)}
            </FormField>
            <FormField
              label={t("settings:projects.uploadMax")}
              hint={t("settings:projects.uploadMaxHint")}
            >
              {(p) => num("projectUploadMaxMb", p)}
            </FormField>
            <ProjectTrash />
          </div>
        </Section>
      )}
    </ConfigPage>
  );
}

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
function ProjectRoots() {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const [depths, setDepths] = useState<Depths>(ROOT_DEFAULTS);
  const [location, setLocation] = useState(ROOT_HUB);
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  const devices = useDevices();
  const online = hubOn ? (devices.data ?? []).filter((d) => d.online) : [];
  const device = location === ROOT_HUB ? undefined : location;
  const roots = useRoots();
  // Users who can be picked to edit a root: a viewer never edits.
  const editors = (useUsers(!!useMe()).data ?? []).filter((u) => u.role !== "viewer");
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
      <legend className="mb-1 font-medium">{t("settings:projects.roots")}</legend>
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

/** Deleted project files wait in a trash folder inside each project folder root until emptied here. */
function ProjectTrash() {
  const { t } = useTranslation();
  const trash = useProjectTrash().data;
  const empty = useEmptyProjectTrash();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="font-medium">{t("settings:projects.trash")}</span>
      <span className="text-muted">{t("settings:projects.trashHint")}</span>
      <div className="flex flex-wrap items-center gap-3">
        <span aria-live="polite">
          {trash &&
            (trash.items
              ? t("settings:projects.trashSize", {
                  count: trash.items,
                  size: formatMegabytes(trash.bytes),
                })
              : t("settings:projects.trashNone"))}
        </span>
        <Button
          variant="danger"
          disabled={!trash?.items || empty.isPending}
          onClick={() => setConfirming(true)}
        >
          {t("settings:projects.trashEmpty")}
        </Button>
      </div>
      {empty.isError && (
        <p role="alert" className="text-bad">
          {t("settings:projects.trashError")}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={t("settings:projects.trashConfirmTitle")}
        description={t("settings:projects.trashConfirm")}
        confirmLabel={t("settings:projects.trashEmpty")}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          empty.mutate();
        }}
      />
    </div>
  );
}

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const SPOOL_ALERTS = [
  {
    key: "spoolNoPriceAlert",
    label: "settings:alerts.spoolNoPrice",
    hint: "settings:alerts.spoolNoPriceHint",
  },
  {
    key: "spoolNoOpenDateAlert",
    label: "settings:alerts.spoolNoOpenDate",
    hint: "settings:alerts.spoolNoOpenDateHint",
  },
] as const;

export function AlertsConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="alerts">
      {({ v, commit, num }) => (
        <>
          <Section title={t("settings:sections.alerts")}>
            <p className="text-muted">{t("settings:alerts.hint")}</p>
            <FormField label={t("settings:alerts.lowSpool")}>
              {(p) => num("lowSpoolGrams", p)}
            </FormField>
            {SPOOL_ALERTS.map(({ key, label, hint }) => (
              <div key={key}>
                <Switch
                  label={t(label)}
                  aria-describedby={`${key}-hint`}
                  checked={v[key]}
                  onChange={(e) => commit({ [key]: e.target.checked })}
                />
                <p id={`${key}-hint`} className="text-muted">
                  {t(hint)}
                </p>
              </div>
            ))}
            <FormField label={t("settings:alerts.maintenanceLead")}>
              {(p) => num("maintenanceLeadDays", p)}
            </FormField>
            <FormField label={t("settings:alerts.maintenanceLeadHours")}>
              {(p) => num("maintenanceLeadHours", p)}
            </FormField>
            <FormField label={t("settings:alerts.maintenanceLeadPrints")}>
              {(p) => num("maintenanceLeadPrints", p)}
            </FormField>
          </Section>
          <Section title={t("settings:alerts.channels")}>
            <ChannelsSection />
          </Section>
        </>
      )}
    </ConfigPage>
  );
}

export function PrintersConfigPage() {
  const { t } = useTranslation();
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  return (
    <ConfigPage module="printers">
      {({ v, commit }) => {
        return (
          <>
            <Section title={t("settings:sections.printers")}>
              <FormField
                label={t("settings:printers.default")}
                hint={t("settings:printers.defaultHint")}
              >
                {(p) => (
                  <Combobox
                    {...p}
                    value={v.defaultPrinterId ?? ""}
                    onChange={(x) => commit({ defaultPrinterId: x || null })}
                    options={[
                      { value: "", label: t("settings:printers.defaultNone") },
                      ...printers.map((pr) => ({ value: pr.id, label: pr.name })),
                    ]}
                  />
                )}
              </FormField>
              <FormField label={t("settings:printers.label")} hint={t("settings:printers.hint")}>
                {(p) => (
                  <LinesInput
                    {...p}
                    lines={v.printerStates}
                    onCommit={(printerStates) => commit({ printerStates })}
                  />
                )}
              </FormField>
            </Section>
            <Catalog />
          </>
        );
      }}
    </ConfigPage>
  );
}

/** One value per line, saved on blur; blank lines and repeats dropped, never left empty. */
function LinesInput({
  lines,
  onCommit,
  ...p
}: {
  lines: string[];
  onCommit: (lines: string[]) => void;
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}) {
  const text = lines.join("\n");
  return (
    <textarea
      {...p}
      className={`${inputClass} h-24 py-2`}
      key={text}
      defaultValue={text}
      onBlur={(e) => {
        const next = [
          ...new Set(
            e.target.value
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean),
          ),
        ];
        if (next.length && next.join("|") !== lines.join("|")) onCommit(next);
        else e.target.value = text;
      }}
    />
  );
}

export function OrdersConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="orders">
      {({ v, commit }) => (
        <Section title={t("settings:sections.orders")}>
          <FormField label={t("settings:orders.label")} hint={t("settings:orders.hint")}>
            {(p) => (
              <LinesInput
                {...p}
                lines={v.orderStatuses}
                onCommit={(orderStatuses) => commit({ orderStatuses })}
              />
            )}
          </FormField>
        </Section>
      )}
    </ConfigPage>
  );
}

export function FilamentConfigPage() {
  return (
    <ConfigPage module="filament">
      {() => (
        <div className="grid gap-8">
          <FilamentProfiles />
          <FilamentCatalog />
        </div>
      )}
    </ConfigPage>
  );
}
