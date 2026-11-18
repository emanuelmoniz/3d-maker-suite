import { IMPORT_ENTITIES, type ImportEntity } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField } from "../../components/FormField.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { ExportSection } from "./ExportSection.tsx";
import { ENTITIES } from "./entities.ts";
import { ImportFlow } from "./ImportFlow.tsx";

export const DATA_TABS = ["import", "export"] as const;
export type DataTab = (typeof DATA_TABS)[number];

function ImportSection() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<ImportEntity>("spools");
  return (
    <section aria-label={t("import:import.title")} className="grid gap-4">
      <p className="text-muted">{t("import:import.hint")}</p>
      <p className="text-muted">{t("import:presetsFromSlicer")}</p>

      <ImportFlow
        key={entity}
        entity={entity}
        picker={
          <FormField label={t("import:entity")}>
            {(p) => (
              <Combobox
                {...p}
                value={entity}
                onChange={(v) => setEntity(v as ImportEntity)}
                options={IMPORT_ENTITIES.map((e) => ({
                  value: e,
                  label: t(ENTITIES[e].label),
                }))}
              />
            )}
          </FormField>
        }
      />
    </section>
  );
}

/** The Data tab of Settings: Import and Export, a tab each. */
export function ImportPage({ tab }: { tab: DataTab }) {
  const { t } = useTranslation();
  return (
    <>
      <Tabs
        label={t("import:tabs.label")}
        items={[
          { to: "/settings/data/import", label: t("import:import.title") },
          { to: "/settings/data/export", label: t("import:exportAll.title") },
        ]}
      />
      {tab === "import" ? <ImportSection /> : <ExportSection />}
    </>
  );
}
