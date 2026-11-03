import { DEVICE_FOLDER_MAX_MB_LIMIT } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Section } from "../../components/Section.tsx";
import { useAlertCoverage } from "../../lib/alerts.ts";
import { useCan } from "../../lib/auth.ts";
import { formatList, formatMegabytes, formatSize } from "../../lib/format.ts";
import { useVersionsUsage } from "../../lib/hub.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { usePrinters } from "../../lib/printers.ts";
import { useEmptyProjectTrash, useProjectTrash } from "../../lib/projects.ts";
import { ChannelsSection } from "../alerts/ChannelsSection.tsx";
import { FilamentCatalog, FilamentProfiles } from "../filament/Catalog.tsx";
import { Catalog } from "../printers/Catalog.tsx";
import { ChangeProjectsRoot } from "./ChangeProjectsRoot.tsx";
import { type ConfigCtx, ConfigPage } from "./ConfigPage.tsx";
import { ProjectRoots } from "./ProjectRoots.tsx";

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
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  return (
    <ConfigPage module="projects">
      {({ num }) => (
        <>
          <Section title={t("settings:projects.roots")} wide help="docs/projects.md">
            <ProjectRoots />
            <ChangeProjectsRoot />
          </Section>
          <Section title={t("settings:projects.scanning")}>
            <FormField
              label={t("settings:projects.maxFiles")}
              hint={t("settings:projects.maxFilesHint")}
            >
              {(p) => num("projectScanMaxFiles", p)}
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
          </Section>
          {hubOn && (
            <Section title={t("settings:projects.hubDevices")}>
              <FormField
                label={t("settings:projects.deviceFolderMax")}
                hint={t("settings:projects.deviceFolderMaxHint", {
                  max: DEVICE_FOLDER_MAX_MB_LIMIT,
                })}
              >
                {(p) => num("deviceFolderMaxMb", p)}
              </FormField>
            </Section>
          )}
          <Section title={t("settings:projects.trash")}>
            <ProjectTrash />
          </Section>
        </>
      )}
    </ConfigPage>
  );
}

/** Deleted project files wait in a trash folder inside each project folder root until emptied here. */
function ProjectTrash() {
  const { t } = useTranslation();
  const trash = useProjectTrash().data;
  const empty = useEmptyProjectTrash();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="grid gap-2">
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

/** ADR-0016: a condition kind no enabled user gets would be raised for nobody. */
function Uncovered() {
  const { t } = useTranslation();
  const kinds = useAlertCoverage().data ?? [];
  const roles = useCan("users.manage");
  if (!kinds.length) return null;
  return (
    <p role="status" className="text-warn">
      {t("settings:alerts.uncovered", {
        count: kinds.length,
        kinds: formatList(kinds.map((k) => t(`alerts:kindNames.${k}`))),
      })}{" "}
      {roles && (
        <Link to="/settings" hash="roles" className="font-medium text-accent hover:underline">
          {t("settings:alerts.editRoles")}
        </Link>
      )}
    </p>
  );
}

export function AlertsConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="alerts">
      {({ num }) => (
        <>
          <Section title={t("settings:sections.alerts")}>
            <p className="text-muted">{t("settings:alerts.hint")}</p>
            <Uncovered />
            <FormField label={t("settings:alerts.lowSpool")}>
              {(p) => num("lowSpoolGrams", p)}
            </FormField>
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

const LOCK_HINTS = {
  off: "hub:settings.lockHints.off",
  on: "hub:settings.lockHints.on",
  strict: "hub:settings.lockHints.strict",
} as const;

/** Hub management settings: the sync (mass delete guard, locks) and file versions. */
export function HubConfigPage() {
  const { t } = useTranslation();
  const usage = useVersionsUsage().data;
  return (
    <ConfigPage module="hub">
      {({ v: values, commit }) => {
        const {
          hubDeleteGuard: v,
          hubLocks: locks,
          hubLockIdleMin: idle,
          hubVersions: versions,
          hubVersionsKeep: keep,
          hubDefaultSyncMode: syncMode,
        } = values;
        return (
          <Section title={t("hub:settings.title")} help="docs/hub.md">
            <div className="grid gap-4 sm:max-w-md">
              <FormField
                label={t("hub:settings.deleteGuard")}
                hint={t("hub:settings.deleteGuardHint")}
              >
                {(p) => (
                  <input
                    key={v}
                    {...p}
                    className={inputClass}
                    type="number"
                    min={1}
                    max={10_000}
                    step={1}
                    defaultValue={v}
                    onBlur={(e) => {
                      const n = e.target.valueAsNumber;
                      if (e.target.checkValidity() && Number.isFinite(n) && n !== v)
                        commit({ hubDeleteGuard: n });
                    }}
                  />
                )}
              </FormField>
              <FormField label={t("hub:settings.locks")} hint={t(LOCK_HINTS[locks])}>
                {(p) => (
                  <Combobox
                    {...p}
                    value={locks}
                    onChange={(x) =>
                      (x === "off" || x === "on" || x === "strict") && commit({ hubLocks: x })
                    }
                    options={[
                      { value: "off", label: t("hub:settings.lockModes.off") },
                      { value: "on", label: t("hub:settings.lockModes.on") },
                      { value: "strict", label: t("hub:settings.lockModes.strict") },
                    ]}
                  />
                )}
              </FormField>
              {locks !== "off" && (
                <FormField label={t("hub:settings.lockIdle")} hint={t("hub:settings.lockIdleHint")}>
                  {(p) => (
                    <input
                      key={idle}
                      {...p}
                      className={inputClass}
                      type="number"
                      min={5}
                      max={1440}
                      step={1}
                      defaultValue={idle}
                      onBlur={(e) => {
                        const n = e.target.valueAsNumber;
                        if (e.target.checkValidity() && Number.isFinite(n) && n !== idle)
                          commit({ hubLockIdleMin: n });
                      }}
                    />
                  )}
                </FormField>
              )}
              <FormField
                label={t("hub:settings.defaultSyncMode")}
                hint={t("hub:settings.defaultSyncModeHint")}
              >
                {(p) => (
                  <Combobox
                    {...p}
                    value={syncMode}
                    onChange={(x) =>
                      (x === "all" || x === "selected") && commit({ hubDefaultSyncMode: x })
                    }
                    options={[
                      { value: "selected", label: t("hub:devices.syncModes.selected") },
                      { value: "all", label: t("hub:devices.syncModes.all") },
                    ]}
                  />
                )}
              </FormField>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={versions}
                  onChange={(e) => commit({ hubVersions: e.target.checked })}
                />
                <span className="font-medium">{t("hub:settings.versions")}</span>
              </label>
              <p className="text-muted">{t("hub:settings.versionsHint")}</p>
              {versions && (
                <FormField
                  label={t("hub:settings.versionsKeep")}
                  hint={t("hub:settings.versionsKeepHint")}
                >
                  {(p) => (
                    <input
                      key={keep}
                      {...p}
                      className={inputClass}
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      defaultValue={keep}
                      onBlur={(e) => {
                        const n = e.target.valueAsNumber;
                        if (e.target.checkValidity() && Number.isFinite(n) && n !== keep)
                          commit({ hubVersionsKeep: n });
                      }}
                    />
                  )}
                </FormField>
              )}
              {usage && (versions || usage.files > 0) && (
                <p className="text-muted">
                  {t("hub:settings.usage", { count: usage.files, size: formatSize(usage.bytes) })}
                </p>
              )}
            </div>
          </Section>
        );
      }}
    </ConfigPage>
  );
}
