import { DATE_FORMATS, type Preferences } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { Combobox } from "../components/Combobox.tsx";
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
              <Combobox {...p} value={v.language} options={[{ value: "en", label: "English" }]} />
            )}
          </FormField>
          <FormField label={t("settings:general.units")}>
            {(p) => (
              <Combobox
                {...p}
                value={v.units}
                onChange={(x) => commit({ units: x as Preferences["units"] })}
                options={[
                  { value: "metric", label: t("settings:general.unitsMetric") },
                  { value: "imperial", label: t("settings:general.unitsImperial") },
                ]}
              />
            )}
          </FormField>
          <FormField label={t("settings:general.dateFormat")}>
            {(p) => (
              <Combobox
                {...p}
                value={v.dateFormat}
                onChange={(x) => commit({ dateFormat: x as Preferences["dateFormat"] })}
                options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
              />
            )}
          </FormField>
          <FormField label={t("settings:general.timeFormat")}>
            {(p) => (
              <Combobox
                {...p}
                value={v.timeFormat}
                onChange={(x) => commit({ timeFormat: x as Preferences["timeFormat"] })}
                options={[
                  { value: "24h", label: t("settings:general.time24h") },
                  { value: "12h", label: t("settings:general.time12h") },
                ]}
              />
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
              <Combobox
                {...p}
                value={v.accent}
                onChange={(x) => setTheme({ accent: x as Preferences["accent"] })}
                options={ACCENTS.map((a) => ({ value: a, label: t(ACCENT_LABELS[a]) }))}
              />
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
