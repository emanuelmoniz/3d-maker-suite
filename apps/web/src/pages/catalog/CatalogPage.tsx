import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { meQuery, useCan } from "../../lib/auth.ts";
import { FilamentCatalog } from "../filament/Catalog.tsx";
import { PresetsHint } from "../presets/PresetsHint.tsx";
import { FilamentPresets, MachinePresets, ProcessPresets } from "../presets/PresetTables.tsx";
import { Catalog } from "../printers/Catalog.tsx";

export const CATALOG_TABS = ["printers", "filament"] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

/**
 * Each tab's tables, by their `#<id>` (ADR-0023), with their titles: written out so
 * `pnpm i18n:check` sees the keys. An old link to a table lands on its tab.
 */
export const TABLES: Record<CatalogTab, Record<string, string>> = {
  printers: {
    brands: "printers:catalog.brands.title",
    "printer-models": "printers:catalog.models.title",
    "machine-presets": "printers:catalog.presets.title",
    "process-presets": "printers:catalog.processPresets.title",
  },
  filament: {
    "filament-brands": "filament:catalog.brands.title",
    "filament-materials": "filament:catalog.materials.title",
    "filament-presets": "filament:presets.title",
  },
};

/** The tab a table `#<id>` is on, if it is one. */
export const tabOf = (hash: string) =>
  CATALOG_TABS.find((tab) => Object.hasOwn(TABLES[tab], hash.replace(/^#/, "")));

const INTRO = {
  printers: "catalog:intro.printers",
  filament: "catalog:intro.filament",
} as const;

/** Brands, models, materials and their presets (ADR-0023), one tab per part. Needs `catalog` read. */
export function CatalogPage({ tab }: { tab: CatalogTab }) {
  const { t } = useTranslation();
  const allowed = useCan("catalog", "read");
  if (!useQuery(meQuery).data) return null;
  if (!allowed) return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader
        title={t("nav:items.catalog.label")}
        description={t("nav:items.catalog.description")}
        actions={<SettingsLink module="catalog" />}
      />
      <Tabs
        label={t("catalog:tabs.label")}
        items={[
          { to: "/catalog/printers", label: t("catalog:tabs.printers") },
          { to: "/catalog/filament", label: t("catalog:tabs.filament") },
        ]}
      />
      <p className="mb-4 max-w-prose text-muted">{t(INTRO[tab])}</p>
      {/* Four tables make a long tab: a jump to each, in page order. */}
      <nav aria-label={t("catalog:tables")} className="mb-8">
        <ol className="flex flex-wrap gap-2">
          {Object.entries(TABLES[tab]).map(([id, title]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-fg"
              >
                {t(title)}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="grid gap-10">
        {tab === "printers" ? (
          <>
            <Catalog />
            <MachinePresets />
            <ProcessPresets />
          </>
        ) : (
          <>
            <FilamentCatalog />
            <FilamentPresets />
          </>
        )}
        <PresetsHint />
      </div>
    </>
  );
}
