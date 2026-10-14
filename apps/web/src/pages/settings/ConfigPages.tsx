import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Section } from "../../components/Section.tsx";
import { ChannelsSection } from "../alerts/ChannelsSection.tsx";
import { FilamentCatalog, FilamentProfiles } from "../filament/Catalog.tsx";
import { Catalog } from "../printers/Catalog.tsx";
import { ConfigPage } from "./ConfigPage.tsx";

export function CostsConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="costs">
      {({ v, commit, num }) => (
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
      )}
    </ConfigPage>
  );
}

export function PrintsConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="prints">
      {({ v, commit }) => {
        const reasons = v.failureReasons.join("\n");
        return (
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
        );
      }}
    </ConfigPage>
  );
}

export function ProjectsConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="projects">
      {({ v, commit, num }) => (
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
        </Section>
      )}
    </ConfigPage>
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
        </>
      )}
    </ConfigPage>
  );
}

export function PrintersConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="printers">
      {({ v, commit }) => {
        const states = v.printerStates.join("\n");
        return (
          <>
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
            <Catalog />
          </>
        );
      }}
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
