import { LOG_LEVELS, LOG_MODULES, type Preferences } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
export const LEVEL_LABELS = {
  debug: "logs:levels.debug",
  info: "logs:levels.info",
  success: "logs:levels.success",
  warn: "logs:levels.warn",
  error: "logs:levels.error",
} as const;
export const MODULE_LABELS = {
  system: "logs:modules.system",
  printers: "logs:modules.printers",
  accessories: "logs:modules.accessories",
  maintenance: "logs:modules.maintenance",
  filament: "logs:modules.filament",
  projects: "logs:modules.projects",
  prints: "logs:modules.prints",
  quotes: "logs:modules.quotes",
  orders: "logs:modules.orders",
  clients: "logs:modules.clients",
  stats: "logs:modules.stats",
  alerts: "logs:modules.alerts",
  import: "logs:modules.import",
  integrations: "logs:modules.integrations",
  backups: "logs:modules.backups",
  settings: "logs:modules.settings",
} as const;

/** Settings -> Logs: on/off, what is kept and for how long. */
export function LogSection() {
  const { t } = useTranslation();
  const v = usePreferences().data?.values;
  const save = useSavePreferences();
  if (!v) return null;

  const toggle = <K extends "logLevels" | "logModules">(
    key: K,
    all: readonly Preferences[K][number][],
    item: Preferences[K][number],
    on: boolean,
  ) => {
    const cur = v[key] as string[];
    // Kept in the declared order, so the saved list reads the same as the checkboxes.
    save.mutate({ [key]: all.filter((x) => (x === item ? on : cur.includes(x))) });
  };
  const number =
    (key: "logRetentionDays" | "logMaxEntries", min: number, max: number) => (p: object) => (
      <input
        {...p}
        className={inputClass}
        type="number"
        min={min}
        max={max}
        key={`${key}-${v[key]}`}
        defaultValue={v[key]}
        onBlur={(e) => {
          const n = e.target.valueAsNumber;
          if (e.target.checkValidity() && n !== v[key]) save.mutate({ [key]: n });
          else e.target.value = String(v[key]);
        }}
      />
    );

  return (
    <div className="grid gap-4">
      <p className="text-muted">{t("settings:logs.hint")}</p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={v.logActive}
          onChange={(e) => save.mutate({ logActive: e.target.checked })}
        />
        <span className="font-medium">{t("settings:logs.active")}</span>
      </label>
      <fieldset className="grid gap-1">
        <legend className="mb-1 font-medium">{t("settings:logs.levels")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {LOG_LEVELS.map((l) => (
            <label key={l} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={v.logLevels.includes(l)}
                onChange={(e) => toggle("logLevels", LOG_LEVELS, l, e.target.checked)}
              />
              {t(LEVEL_LABELS[l])}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-1">
        <legend className="mb-1 font-medium">{t("settings:logs.modules")}</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {LOG_MODULES.map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={v.logModules.includes(m)}
                onChange={(e) => toggle("logModules", LOG_MODULES, m, e.target.checked)}
              />
              {t(MODULE_LABELS[m])}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label={t("settings:logs.days")} hint={t("settings:logs.daysHint")}>
        {number("logRetentionDays", 1, 365)}
      </FormField>
      <FormField label={t("settings:logs.max")} hint={t("settings:logs.maxHint")}>
        {number("logMaxEntries", 100, 1_000_000)}
      </FormField>
    </div>
  );
}
