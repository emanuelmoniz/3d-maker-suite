import { DATE_FORMATS, type Preferences } from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../components/Combobox.tsx";
import { FormField } from "../components/FormField.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { Section } from "../components/Section.tsx";
import { api } from "../lib/api.ts";
import { usePreferences, useSavePreferences } from "../lib/preferences.ts";
import { ACCENTS, setTheme } from "../lib/theme.ts";
import { ThemeToggle } from "../shell/ThemeToggle.tsx";
import { AboutSection } from "./settings/AboutSection.tsx";
import { BackupSection } from "./settings/BackupSection.tsx";
import { BrandingFields } from "./settings/BrandingFields.tsx";
import { LogSection } from "./settings/LogSection.tsx";
import { ServerActions, ServerSection, StartAtLogin } from "./settings/ServerSection.tsx";

const ACCENT_LABELS = {
  teal: "settings:appearance.accents.teal",
  blue: "settings:appearance.accents.blue",
  violet: "settings:appearance.accents.violet",
  rose: "settings:appearance.accents.rose",
  amber: "settings:appearance.accents.amber",
} as const;

/** Hours:minutes:seconds the server has been up, ticking each second from its reported start. */
function ServerUptime() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ startedAt: string }>("GET", "/api/health"),
    refetchInterval: 30_000,
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!data) return null;
  const total = Math.max(0, Math.floor((now - Date.parse(data.startedAt)) / 1000));
  const time = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return t("settings:uptime", { time });
}

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
        description={<ServerUptime />}
        actions={<ServerActions />}
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
          <StartAtLogin />
          <div className="grid gap-1.5">
            <span className="font-medium">{t("settings:dataDir.label")}</span>
            <span className="text-muted wrap-anywhere">{data.dataDir}</span>
          </div>
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

        <Section title={t("settings:sections.logs")}>
          <LogSection />
        </Section>

        <Section title={t("settings:sections.about")} id="updates">
          <AboutSection />
        </Section>
      </div>
    </>
  );
}
