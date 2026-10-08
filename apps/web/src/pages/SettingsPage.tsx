import type { Preferences } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plug } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../components/FormField.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { useLibrarySources } from "../lib/filament.ts";
import { usePreferences, useSavePreferences } from "../lib/preferences.ts";
import { ACCENTS, setTheme } from "../lib/theme.ts";
import { ThemeToggle } from "../shell/ThemeToggle.tsx";
import { ChannelsSection } from "./alerts/ChannelsSection.tsx";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <div className="grid gap-4 sm:max-w-md">{children}</div>
    </section>
  );
}

const ACCENT_LABELS = {
  teal: "settings:appearance.accents.teal",
  blue: "settings:appearance.accents.blue",
  violet: "settings:appearance.accents.violet",
  rose: "settings:appearance.accents.rose",
  amber: "settings:appearance.accents.amber",
} as const;

type NumKey =
  | "energyCostPerKwh"
  | "printerLifetimeHours"
  | "laborRatePerHour"
  | "failureMarginPct"
  | "markupPct"
  | "lowSpoolGrams"
  | "maintenanceLeadDays"
  | "projectScanDepth"
  | "viewerMaxMb";

export function SettingsPage() {
  const { t } = useTranslation();
  const { data, isError } = usePreferences();
  const save = useSavePreferences();
  const sources = useLibrarySources();

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
  const states = v.printerStates.join("\n");
  const reasons = v.failureReasons.join("\n");

  // Text/number inputs commit on blur (uncontrolled, re-keyed by saved value); selects commit on change.
  const commit = (patch: Partial<Preferences>) => save.mutate(patch);
  const num = (key: NumKey) => ({
    type: "number" as const,
    min: key === "projectScanDepth" || key === "viewerMaxMb" ? 1 : 0,
    max: key === "projectScanDepth" ? 5 : undefined,
    step:
      key === "energyCostPerKwh" || key === "laborRatePerHour"
        ? 0.01
        : key.endsWith("Pct")
          ? 0.1
          : 1,
    defaultValue: v[key],
    key: `${key}-${v[key]}`,
    onBlur: (e: { target: HTMLInputElement }) => {
      const n = e.target.valueAsNumber;
      if (e.target.checkValidity() && Number.isFinite(n) && n !== v[key]) commit({ [key]: n });
    },
  });

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
          <FormField
            label={t("settings:general.defaultPrinter")}
            hint={t("settings:general.defaultPrinterHint")}
          >
            {(p) => (
              <input
                {...p}
                className={inputClass}
                key={`printer-${v.defaultPrinterId}`}
                defaultValue={v.defaultPrinterId ?? ""}
                onBlur={(e) => {
                  const id = e.target.value.trim() || null;
                  if (id !== v.defaultPrinterId) commit({ defaultPrinterId: id });
                }}
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
        </Section>

        <Section title={t("settings:sections.costs")}>
          <FormField label={t("settings:costs.currency")} hint={t("settings:costs.currencyHint")}>
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
            {(p) => <input {...p} className={inputClass} {...num("energyCostPerKwh")} />}
          </FormField>
          <FormField label={t("settings:costs.lifetime")} hint={t("settings:costs.lifetimeHint")}>
            {(p) => <input {...p} className={inputClass} {...num("printerLifetimeHours")} />}
          </FormField>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.includeMaintenanceCost}
              onChange={(e) => commit({ includeMaintenanceCost: e.target.checked })}
            />
            <span>
              <span className="font-medium">{t("settings:costs.maintenance")}</span>
              <span className="block text-muted">{t("settings:costs.maintenanceHint")}</span>
            </span>
          </label>
          <FormField label={t("settings:costs.laborRate")}>
            {(p) => <input {...p} className={inputClass} {...num("laborRatePerHour")} />}
          </FormField>
          <FormField label={t("settings:costs.failureMargin")}>
            {(p) => <input {...p} className={inputClass} {...num("failureMarginPct")} />}
          </FormField>
          <FormField label={t("settings:costs.markup")}>
            {(p) => <input {...p} className={inputClass} {...num("markupPct")} />}
          </FormField>
        </Section>

        <Section title={t("settings:sections.printers")}>
          <FormField label={t("settings:printers.label")} hint={t("settings:printers.hint")}>
            {(p) => (
              <textarea
                {...p}
                className={`${inputClass} h-24 py-2`}
                key={`states-${states}`}
                defaultValue={states}
                onBlur={(e) => {
                  const next = [
                    ...new Set(
                      e.target.value
                        .split(/\r?\n/)
                        .map((l) => l.trim())
                        .filter(Boolean),
                    ),
                  ];
                  if (next.length && next.join("|") !== v.printerStates.join("|"))
                    commit({ printerStates: next });
                  else e.target.value = states;
                }}
              />
            )}
          </FormField>
        </Section>

        <Section title={t("settings:sections.prints")}>
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

        <Section title={t("settings:sections.projects")}>
          <FormField label={t("settings:projects.roots")} hint={t("settings:projects.rootsHint")}>
            {(p) => (
              <textarea
                {...p}
                className={`${inputClass} h-24 py-2`}
                key={`roots-${v.projectRoots.join("\n")}`}
                defaultValue={v.projectRoots.join("\n")}
                onBlur={(e) => {
                  const roots = e.target.value
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean);
                  if (roots.join("\n") !== v.projectRoots.join("\n"))
                    commit({ projectRoots: roots });
                }}
              />
            )}
          </FormField>
          <FormField label={t("settings:projects.depth")} hint={t("settings:projects.depthHint")}>
            {(p) => <input {...p} className={inputClass} {...num("projectScanDepth")} />}
          </FormField>
          <FormField
            label={t("settings:projects.viewerMax")}
            hint={t("settings:projects.viewerMaxHint")}
          >
            {(p) => <input {...p} className={inputClass} {...num("viewerMaxMb")} />}
          </FormField>
          <FormField label={t("settings:projects.slicer")} hint={t("settings:projects.slicerHint")}>
            {(p) => (
              <input
                {...p}
                className={inputClass}
                key={`slicer-${v.slicerPath}`}
                defaultValue={v.slicerPath}
                onBlur={(e) => {
                  const path = e.target.value.trim();
                  if (path !== v.slicerPath) commit({ slicerPath: path });
                }}
              />
            )}
          </FormField>
        </Section>

        {sources.data && sources.data.length > 0 && (
          <Section title={t("settings:sections.libraries")}>
            {sources.data.map((src) => (
              <FormField
                key={src.id}
                label={t(`filament:library.sources.${src.id}`)}
                hint={t("settings:libraries.hint", { dir: src.detectedDir ?? "–" })}
              >
                {(p) => (
                  <input
                    {...p}
                    className={inputClass}
                    key={`lib-${src.id}-${v.libraryPaths[src.id] ?? ""}`}
                    defaultValue={v.libraryPaths[src.id] ?? ""}
                    placeholder={src.detectedDir ?? ""}
                    onBlur={(e) => {
                      const path = e.target.value.trim();
                      if (path === (v.libraryPaths[src.id] ?? "")) return;
                      const { [src.id]: _old, ...rest } = v.libraryPaths;
                      commit({ libraryPaths: path ? { ...rest, [src.id]: path } : rest });
                    }}
                  />
                )}
              </FormField>
            ))}
          </Section>
        )}

        <Section title={t("settings:sections.integrations")}>
          <p className="text-muted">{t("settings:integrations.body")}</p>
          <Link
            to="/settings/integrations"
            className="inline-flex items-center gap-2 font-medium text-accent hover:underline"
          >
            <Plug className="size-4" aria-hidden />
            {t("settings:integrations.manage")}
          </Link>
        </Section>

        <Section title={t("settings:sections.alerts")}>
          <p className="text-muted">{t("settings:alerts.hint")}</p>
          <FormField label={t("settings:alerts.lowSpool")}>
            {(p) => <input {...p} className={inputClass} {...num("lowSpoolGrams")} />}
          </FormField>
          <FormField label={t("settings:alerts.maintenanceLead")}>
            {(p) => <input {...p} className={inputClass} {...num("maintenanceLeadDays")} />}
          </FormField>
        </Section>

        <Section title={t("settings:alerts.channels")}>
          <ChannelsSection />
        </Section>
      </div>
    </>
  );
}
