import type { Preferences } from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { type LinkProps, Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { meQuery, useCan } from "../../lib/auth.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";

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
  module: "quotes" | "orders" | "prints" | "projects" | "alerts" | "printers" | "filament";
  children: (ctx: ConfigCtx) => ReactNode;
}) {
  const { t } = useTranslation();
  const { data, isError } = usePreferences();
  const save = useSavePreferences();
  const description = t(`nav:items.${module}.label`);
  const title = t("common:actions.moduleSettings", { module: description });
  const backTo = { to: `/${module}` as LinkProps["to"] };
  const admin = useCan("admin");

  // Module settings are admin-only; everyone else goes back to the module.
  const loaded = !!useQuery(meQuery).data;
  if (!loaded) return null;
  if (!admin) return <Navigate {...backTo} replace />;
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
          : key === "viewerMaxMb" || key === "projectUploadMaxMb" || key === "gramsPerHour"
            ? 1
            : 0
      }
      max={key === "projectScanMaxFiles" ? 100_000 : undefined}
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
      <div className="grid gap-4">{children({ v, commit, num })}</div>
    </>
  );
}
