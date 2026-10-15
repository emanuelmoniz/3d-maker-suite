import { DATE_FORMATS, type Preferences } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../components/FormField.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { Section } from "../components/Section.tsx";
import { usePreferences, useSavePreferences } from "../lib/preferences.ts";
import { ACCENTS, setTheme } from "../lib/theme.ts";
import { ThemeToggle } from "../shell/ThemeToggle.tsx";
import { BackupSection } from "./settings/BackupSection.tsx";
import { BrandingFields } from "./settings/BrandingFields.tsx";
import { ServerSection } from "./settings/ServerSection.tsx";

const ACCENT_LABELS = {
  teal: "settings:appearance.accents.teal",
  blue: "settings:appearance.accents.blue",
  violet: "settings:appearance.accents.violet",
  rose: "settings:appearance.accents.rose",
  amber: "settings:appearance.accents.amber",
} as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const { data, isError } = usePreferences();
  const save = useSavePreferences();

  if (isError)
    return (
      <>
        <PageHeader title={t("nav:items.settings.label")} />
        <p role="alert" className="text-bad">
          {t("settings:loadError")}
        </p>
      </>
    );
  if (!data) return null;
  const v = data.values;

  // Text inputs commit on blur (uncontrolled, re-keyed by saved value); selects commit on change.
  const commit = (patch: Partial<Preferences>) => save.mutate(patch);

  return (
    <>
      <PageHeader
        title={t("nav:items.settings.label")}
        description={t("nav:items.settings.description")}
      />
      {save.isError && (
        <p role="alert" className="mb-4 text-bad">
          {t("settings:saveError")}
        </p>
      )}
      <div className="grid gap-4">
        <Section title={t("settings:sections.general")}>
          <FormField label={t("settings:general.language")}>
            {(p) => (
              <select {...p} className={inputClass} value={v.language} onChange={() => {}}>
                <option value="en">English</option>
              </select>
            )}
          </FormField>
          <FormField label={t("settings:general.units")}>
            {(p) => (
              <select
                {...p}
                className={inputClass}
                value={v.units}
                onChange={(e) => commit({ units: e.target.value as Preferences["units"] })}
              >
                <option value="metric">{t("settings:general.unitsMetric")}</option>
                <option value="imperial">{t("settings:general.unitsImperial")}</option>
              </select>
            )}
          </FormField>
          <FormField label={t("settings:general.dateFormat")}>
            {(p) => (
              <select
                {...p}
                className={inputClass}
                value={v.dateFormat}
                onChange={(e) =>
                  commit({ dateFormat: e.target.value as Preferences["dateFormat"] })
                }
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t("settings:general.timeFormat")}>
            {(p) => (
              <select
                {...p}
                className={inputClass}
                value={v.timeFormat}
                onChange={(e) =>
                  commit({ timeFormat: e.target.value as Preferences["timeFormat"] })
                }
              >
                <option value="24h">{t("settings:general.time24h")}</option>
                <option value="12h">{t("settings:general.time12h")}</option>
              </select>
            )}
          </FormField>
          <FormField label={t("settings:dataDir.label")} hint={t("settings:dataDir.hint")}>
            {(p) => <input {...p} className={inputClass} value={data.dataDir} readOnly />}
          </FormField>
        </Section>

        <Section title={t("settings:sections.appearance")}>
          <div className="grid gap-1.5">
            <span className="font-medium">{t("common:theme.label")}</span>
            <ThemeToggle className="w-40" />
          </div>
          <FormField label={t("settings:appearance.accent")}>
            {(p) => (
              <select
                {...p}
                className={inputClass}
                value={v.accent}
                onChange={(e) => setTheme({ accent: e.target.value as Preferences["accent"] })}
              >
                {ACCENTS.map((a) => (
                  <option key={a} value={a}>
                    {t(ACCENT_LABELS[a])}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <BrandingFields />
        </Section>

        <Section title={t("settings:sections.server")}>
          <ServerSection />
        </Section>

        <Section title={t("settings:sections.backup")}>
          <BackupSection />
        </Section>
      </div>
    </>
  );
}
