import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { formatNumber } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";

type Kind = "printer" | "accessory";
type Values = {
  lifetimeHours: number | null;
  includeMaintenanceCost: boolean | null;
  countInCosts: boolean | null;
};

/** The Costs settings a printer or accessory falls back to. */
function useCostDefaults(kind: Kind) {
  const p = usePreferences().data?.values;
  return kind === "printer"
    ? {
        lifetimeHours: p?.printerLifetimeHours ?? 0,
        includeMaintenanceCost: p?.includeMaintenanceCost ?? false,
        countInCosts: p?.printerCountInCosts ?? true,
      }
    : {
        lifetimeHours: p?.accessoryLifetimeHours ?? 0,
        includeMaintenanceCost: p?.accessoryIncludeMaintenanceCost ?? false,
        countInCosts: p?.accessoryCountInCosts ?? true,
      };
}

const bool = (v: string) => (v === "" ? null : v === "true");

/** The form's cost settings; empty = the Costs default. */
export function readCostFields(f: FormData): Values {
  const hours = String(f.get("lifetimeHours") ?? "").trim();
  return {
    lifetimeHours: hours ? Math.round(Number(hours)) : null,
    includeMaintenanceCost: bool(String(f.get("includeMaintenanceCost") ?? "")),
    countInCosts: bool(String(f.get("countInCosts") ?? "")),
  };
}

/** Count in costs, lifetime and maintenance, each defaulting to Settings > Costs. */
export function CostFields({ values, kind }: { values?: Values; kind: Kind }) {
  const { t } = useTranslation();
  const defaults = useCostDefaults(kind);
  const onOff = (v: boolean) => t(v ? "printers:costs.on" : "printers:costs.off");
  const select = (name: "includeMaintenanceCost" | "countInCosts", def: boolean) => (p: object) => (
    <select
      {...p}
      name={name}
      className={inputClass}
      defaultValue={values?.[name] == null ? "" : String(values[name])}
    >
      <option value="">{t("printers:costs.default", { value: onOff(def) })}</option>
      <option value="true">{onOff(true)}</option>
      <option value="false">{onOff(false)}</option>
    </select>
  );
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-2 font-semibold">{t("printers:costs.title")}</legend>
      <FormField
        label={t("printers:costs.count")}
        hint={t(
          kind === "printer" ? "printers:costs.countHintPrinter" : "printers:costs.countHint",
        )}
      >
        {select("countInCosts", defaults.countInCosts)}
      </FormField>
      <FormField label={t("printers:costs.lifetime")} hint={t("printers:costs.lifetimeHint")}>
        {(p) => (
          <input
            {...p}
            name="lifetimeHours"
            type="number"
            min={0}
            step={1}
            className={inputClass}
            placeholder={t("printers:costs.default", {
              value: formatNumber(defaults.lifetimeHours),
            })}
            defaultValue={values?.lifetimeHours ?? ""}
          />
        )}
      </FormField>
      <FormField label={t("printers:costs.maintenance")} hint={t("printers:costs.maintenanceHint")}>
        {select("includeMaintenanceCost", defaults.includeMaintenanceCost)}
      </FormField>
    </fieldset>
  );
}

/** Rows for a detail page: each value, or "Default (…)" with the Costs setting it falls back to. */
export function useCostInfo(
  values: Values | undefined,
  kind: Kind,
): { label: string; value: string }[] {
  const { t } = useTranslation();
  const defaults = useCostDefaults(kind);
  const onOff = (v: boolean) => t(v ? "printers:costs.on" : "printers:costs.off");
  const hours = (h: number) => t("printers:costs.hours", { value: formatNumber(h) });
  const show = <T,>(own: T | null | undefined, def: T, text: (v: T) => string) =>
    own == null ? t("printers:costs.default", { value: text(def) }) : text(own);
  return [
    {
      label: t("printers:costs.count"),
      value: show(values?.countInCosts, defaults.countInCosts, onOff),
    },
    {
      label: t("printers:costs.lifetime"),
      value: show(values?.lifetimeHours, defaults.lifetimeHours, hours),
    },
    {
      label: t("printers:costs.maintenance"),
      value: show(values?.includeMaintenanceCost, defaults.includeMaintenanceCost, onOff),
    },
  ];
}
