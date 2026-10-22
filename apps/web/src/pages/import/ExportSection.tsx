import { useTranslation } from "react-i18next";

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
  return (
    <section className="grid gap-2 border-t border-border pt-4">
      <h2 className="font-semibold">{t("import:exportAll.title")}</h2>
      <p className="text-muted">{t("import:exportAll.hint")}</p>
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
    </section>
  );
}
