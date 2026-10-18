import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";

type Values = {
  lifetimeHours: number | null;
  includeMaintenanceCost: boolean | null;
  countInCosts?: boolean | null;
};
type Defaults = { lifetimeHours: number; includeMaintenanceCost: boolean; countInCosts?: boolean };

const bool = (v: string) => (v === "" ? null : v === "true");

/** The form's cost settings; empty = the Costs default. `countInCosts` only when `defaults` has it. */
export function readCostFields(f: FormData, withCount: boolean): Values {
  const hours = String(f.get("lifetimeHours") ?? "").trim();
  return {
    lifetimeHours: hours ? Math.round(Number(hours)) : null,
    includeMaintenanceCost: bool(String(f.get("includeMaintenanceCost") ?? "")),
    ...(withCount ? { countInCosts: bool(String(f.get("countInCosts") ?? "")) } : {}),
  };
}

/** Lifetime, maintenance (and for accessories "count in costs"), each defaulting to Settings > Costs. */
export function CostFields({ values, defaults }: { values?: Values; defaults: Defaults }) {
  const { t } = useTranslation();
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
      {defaults.countInCosts !== undefined && (
        <FormField label={t("printers:costs.count")} hint={t("printers:costs.countHint")}>
          {select("countInCosts", defaults.countInCosts)}
        </FormField>
      )}
      <FormField label={t("printers:costs.lifetime")} hint={t("printers:costs.lifetimeHint")}>
        {(p) => (
          <input
            {...p}
            name="lifetimeHours"
            type="number"
            min={0}
            step={1}
            className={inputClass}
            placeholder={t("printers:costs.default", { value: defaults.lifetimeHours })}
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
