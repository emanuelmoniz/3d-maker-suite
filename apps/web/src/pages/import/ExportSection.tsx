import { IMPORT_ENTITIES, type ImportEntity } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField } from "../../components/FormField.tsx";
import { useTemplate } from "../../lib/import.ts";
import { ENTITIES, templateBody } from "./entities.ts";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const TABLES = [
  ["printers", "import:exportAll.tables.printers"],
  ["accessories", "import:exportAll.tables.accessories"],
  ["accessory-installs", "import:exportAll.tables.accessoryInstalls"],
  ["brands", "import:exportAll.tables.brands"],
  ["printer-models", "import:exportAll.tables.printerModels"],
  ["machine-profiles", "import:exportAll.tables.machineProfiles"],
  ["print-profiles", "import:exportAll.tables.printProfiles"],
  ["maintenance", "import:exportAll.tables.maintenance"],
  ["maintenance-types", "import:exportAll.tables.maintenanceTypes"],
  ["filament-brands", "import:exportAll.tables.filamentBrands"],
  ["filament-materials", "import:exportAll.tables.filamentMaterials"],
  ["filament-profiles", "import:exportAll.tables.filamentProfiles"],
  ["spools", "import:exportAll.tables.spools"],
  ["projects", "import:exportAll.tables.projects"],
  ["prints", "import:exportAll.tables.prints"],
  ["quotes", "import:exportAll.tables.quotes"],
  ["clients", "import:exportAll.tables.clients"],
  ["orders", "import:exportAll.tables.orders"],
  ["order-projects", "import:exportAll.tables.orderProjects"],
] as const;

export function ExportSection() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<ImportEntity>("spools");
  const exportFile = useTemplate(entity, "export");
  const name = t(ENTITIES[entity].label);

  return (
    <section aria-labelledby="export-title" className="grid gap-4 border-t border-border pt-8">
      <h2 id="export-title" className="text-lg font-semibold">
        {t("import:exportAll.title")}
      </h2>
      <p className="text-muted">{t("import:exportAll.hint")}</p>

      <div className="grid gap-2 rounded-lg border border-border bg-surface p-4">
        <h3 className="font-medium">{t("import:exportAll.sheetTitle")}</h3>
        <p className="text-muted">{t("import:exportAll.sheetHint")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t("import:exportAll.sheetWhat")}>
            {(p) => (
              <Combobox
                {...p}
                value={entity}
                onChange={(v) => setEntity(v as ImportEntity)}
                options={IMPORT_ENTITIES.map((e) => ({ value: e, label: t(ENTITIES[e].label) }))}
              />
            )}
          </FormField>
          <Button
            disabled={exportFile.isPending}
            onClick={() =>
              exportFile.mutate({
                filename: t("import:export.filename", { name }),
                body: templateBody(entity, t),
              })
            }
          >
            {t("import:export.download")}
          </Button>
        </div>
        {exportFile.isError && (
          <p role="alert" className="text-bad">
            {t("import:template.error")}
          </p>
        )}
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-surface p-4">
        <h3 className="font-medium">{t("import:exportAll.rawTitle")}</h3>
        <p className="text-muted">{t("import:exportAll.rawHint")}</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {TABLES.map(([id, label]) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span>{t(label)}</span>
              <span className="flex gap-3">
                {(["csv", "json"] as const).map((f) => (
                  <a
                    key={f}
                    className="font-medium text-accent hover:underline"
                    href={`/api/export/${id}?format=${f}`}
                    download
                  >
                    {f.toUpperCase()}
                  </a>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
