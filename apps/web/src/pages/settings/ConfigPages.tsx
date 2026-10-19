import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { Section } from "../../components/Section.tsx";
import { usePrinters } from "../../lib/printers.ts";
import { ChannelsSection } from "../alerts/ChannelsSection.tsx";
import { FilamentCatalog, FilamentProfiles } from "../filament/Catalog.tsx";
import { Catalog } from "../printers/Catalog.tsx";
import { type ConfigCtx, ConfigPage } from "./ConfigPage.tsx";

type BoolKey =
  | "printerCountInCosts"
  | "includeMaintenanceCost"
  | "accessoryIncludeMaintenanceCost"
  | "accessoryCountInCosts";

export function CostsConfigPage() {
  const { t } = useTranslation();
  const check = ({ v, commit }: ConfigCtx, key: BoolKey, label: string, hint: string) => (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => commit({ [key]: e.target.checked })}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <ConfigPage module="quotes">
      {(ctx) => {
        const { v, commit, num } = ctx;
        return (
          <>
            <Section title={t("settings:sections.costs")}>
              <FormField
                label={t("settings:costs.currency")}
                hint={t("settings:costs.currencyHint")}
              >
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
                {(p) => num("energyCostPerKwh", p)}
              </FormField>
              <FormField label={t("settings:costs.laborRate")}>
                {(p) => num("laborRatePerHour", p)}
              </FormField>
              <FormField label={t("settings:costs.failureMargin")}>
                {(p) => num("failureMarginPct", p)}
              </FormField>
              <FormField label={t("settings:costs.markup")}>{(p) => num("markupPct", p)}</FormField>
            </Section>
            <Section title={t("settings:costs.printers")}>
              {check(
                ctx,
                "printerCountInCosts",
                t("settings:costs.printerCount"),
                t("settings:costs.printerCountHint"),
              )}
              <FormField
                label={t("settings:costs.lifetime")}
                hint={t("settings:costs.lifetimeHint")}
              >
                {(p) => num("printerLifetimeHours", p)}
              </FormField>
              {check(
                ctx,
                "includeMaintenanceCost",
                t("settings:costs.maintenance"),
                t("settings:costs.maintenanceHint"),
              )}
            </Section>
            <Section title={t("settings:costs.accessories")}>
              {check(
                ctx,
                "accessoryCountInCosts",
                t("settings:costs.accessoryCount"),
                t("settings:costs.accessoryCountHint"),
              )}
              <FormField
                label={t("settings:costs.accessoryLifetime")}
                hint={t("settings:costs.accessoryLifetimeHint")}
              >
                {(p) => num("accessoryLifetimeHours", p)}
              </FormField>
              {check(
                ctx,
                "accessoryIncludeMaintenanceCost",
                t("settings:costs.maintenance"),
                t("settings:costs.accessoryMaintenanceHint"),
              )}
            </Section>
          </>
        );
      }}
    </ConfigPage>
  );
}

export function PrintsConfigPage() {
  const { t } = useTranslation();
  return (
    <ConfigPage module="prints">
      {({ v, commit, num }) => {
        const reasons = v.failureReasons.join("\n");
        return (
          <Section title={t("settings:sections.prints")}>
            <FormField label={t("settings:prints.pace")} hint={t("settings:prints.paceHint")}>
              {(p) => num("gramsPerHour", p)}
            </FormField>
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
              <div className="flex items-start gap-2">
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
                <PathPicker
                  label={t("settings:projects.roots")}
                  mode="folder"
                  initial={v.projectRoots.at(-1)}
                  onPick={(dir) =>
                    !v.projectRoots.includes(dir) &&
                    commit({ projectRoots: [...v.projectRoots, dir] })
                  }
                />
              </div>
            )}
          </FormField>
          <FormField label={t("settings:projects.depth")} hint={t("settings:projects.depthHint")}>
            {(p) => num("projectScanDepth", p)}
          </FormField>
          <FormField
            label={t("settings:projects.viewerMax")}
            hint={t("settings:projects.viewerMaxHint")}
          >
            {(p) => num("viewerMaxMb", p)}
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
              {(p) => num("lowSpoolGrams", p)}
            </FormField>
            <FormField label={t("settings:alerts.maintenanceLead")}>
              {(p) => num("maintenanceLeadDays", p)}
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
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  return (
    <ConfigPage module="printers">
      {({ v, commit }) => {
        const states = v.printerStates.join("\n");
        return (
          <>
            <Section title={t("settings:sections.printers")}>
              <FormField
                label={t("settings:printers.default")}
                hint={t("settings:printers.defaultHint")}
              >
                {(p) => (
                  <Combobox
                    {...p}
                    value={v.defaultPrinterId ?? ""}
                    onChange={(x) => commit({ defaultPrinterId: x || null })}
                    options={[
                      { value: "", label: t("settings:printers.defaultNone") },
                      ...printers.map((pr) => ({ value: pr.id, label: pr.name })),
                    ]}
                  />
                )}
              </FormField>
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
