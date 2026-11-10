import { DEVICE_FOLDER_MAX_MB_LIMIT, type Preferences } from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps, Navigate, useLocation } from "@tanstack/react-router";
import { Cable, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { type SettingsModule, useCanSettings } from "../../components/SettingsLink.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { meQuery } from "../../lib/auth.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";
import { PresetsTab } from "../hub/PresetsPage.tsx";

/** Data types: their settings have General and Sources tabs (ADR-0021). */
const SOURCE_MODULES: SettingsModule[] = [
  "printers",
  "prints",
  "filament",
  "projects",
  "catalog",
  "presets",
];

/** Where the back link goes; Presets has no page of its own until Step 4. */
const BACK: Partial<Record<SettingsModule, LinkProps["to"]>> = { presets: "/catalog/presets" };

export type NumKey =
  | "energyCostPerKwh"
  | "printerLifetimeHours"
  | "accessoryLifetimeHours"
  | "gramsPerHour"
  | "laborRatePerHour"
  | "failureMarginPct"
  | "markupPct"
  | "lowSpoolGrams"
  | "maintenanceLeadDays"
  | "maintenanceLeadHours"
  | "maintenanceLeadPrints"
  | "projectScanMaxFiles"
  | "deviceFolderMaxMb"
  | "viewerMaxMb"
  | "projectUploadMaxMb";

export type ConfigCtx = {
  v: Preferences;
  commit: (patch: Partial<Preferences>) => void;
  /** Number input that commits on blur (uncontrolled, re-keyed by saved value). */
  num: (key: NumKey, field: object) => ReactNode;
};

/** Shell of a module config page: header with back link, load/save errors, preferences context. */
export function ConfigPage({
  module,
  children,
}: {
  module: SettingsModule;
  children: (ctx: ConfigCtx) => ReactNode;
}) {
  const { t } = useTranslation();
  const { data, isError } = usePreferences();
  const save = useSavePreferences();
  // Presets: written out so `pnpm i18n:check` sees the key (its sidebar item arrives in Step 4).
  const description =
    module === "presets" ? t("nav:items.presets.label") : t(`nav:items.${module}.label`);
  const title = t("common:actions.moduleSettings", { module: description });
  const backTo = { to: BACK[module] ?? (`/${module}` as LinkProps["to"]) };
  const base = `/${module}/settings`;
  const path = useLocation().pathname;
  const tab0 =
    path === `${base}/sources` ? "sources" : path === `${base}/library` ? "library" : "general";
  const hasTabs = SOURCE_MODULES.includes(module);
  const tab = hasTabs ? tab0 : "general";
  const allowed = useCanSettings(module);

  // Without the permission, back to the module.
  const loaded = !!useQuery(meQuery).data;
  if (!loaded) return null;
  if (!allowed) return <Navigate {...backTo} replace />;
  if (isError)
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        <p role="alert" className="text-bad">
          {t("settings:loadError")}
        </p>
      </>
    );
  if (!data) return null;
  const hub = data.values.hubEnabled;
  const v = data.values;
  const commit = (patch: Partial<Preferences>) => save.mutate(patch);
  // `key` must be passed directly in JSX; React warns when it arrives through a spread.
  const num = (key: NumKey, field: object) => (
    <input
      key={`${key}-${v[key]}`}
      {...field}
      className={inputClass}
      type="number"
      min={
        key === "projectScanMaxFiles"
          ? 100
          : key === "viewerMaxMb" ||
              key === "projectUploadMaxMb" ||
              key === "deviceFolderMaxMb" ||
              key === "gramsPerHour"
            ? 1
            : 0
      }
      max={
        key === "projectScanMaxFiles"
          ? 100_000
          : key === "deviceFolderMaxMb"
            ? DEVICE_FOLDER_MAX_MB_LIMIT
            : undefined
      }
      step={
        key === "energyCostPerKwh" || key === "laborRatePerHour"
          ? 0.01
          : key.endsWith("Pct")
            ? 0.1
            : 1
      }
      defaultValue={v[key]}
      onBlur={(e) => {
        const n = e.target.valueAsNumber;
        if (e.target.checkValidity() && Number.isFinite(n) && n !== v[key]) commit({ [key]: n });
      }}
    />
  );

  return (
    <>
      <PageHeader title={title} backTo={backTo} />
      {save.isError && (
        <p role="alert" className="mb-4 text-bad">
          {t("settings:saveError")}
        </p>
      )}
      {hasTabs && (
        <Tabs
          label={t("settings:tabs.label")}
          items={[
            { to: base as LinkProps["to"], label: t("settings:tabs.general"), exact: true },
            { to: `${base}/sources` as LinkProps["to"], label: t("settings:tabs.sources") },
            ...(module === "presets" && hub
              ? [{ to: `${base}/library` as LinkProps["to"], label: t("settings:tabs.library") }]
              : []),
          ]}
        />
      )}
      {tab === "sources" ? (
        <EmptyState
          icon={Cable}
          title={t("settings:sources.emptyTitle")}
          description={t("settings:sources.emptyText")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                to="/integrations"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 font-medium transition-colors hover:bg-surface-2"
              >
                <Cable className="size-4" aria-hidden="true" />
                {t("settings:sources.integrations")}
              </Link>
              <Link
                to="/hub"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 font-medium transition-colors hover:bg-surface-2"
              >
                <Server className="size-4" aria-hidden="true" />
                {t("settings:sources.hub")}
              </Link>
            </div>
          }
        />
      ) : tab === "library" ? (
        <PresetsTab />
      ) : (
        <div className="grid gap-4">{children({ v, commit, num })}</div>
      )}
    </>
  );
}
