import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { meQuery, useCan } from "../../lib/auth.ts";
import { FilamentCatalog } from "../filament/Catalog.tsx";
import { Catalog } from "../printers/Catalog.tsx";

export const CATALOG_TABS = ["printers", "filament"] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

/** The tables of Catalog → Printers: their old `/printers/settings#<id>` lands on them. */
export const PRINTER_TABLES = ["brands", "printer-models"];
/** The preset tables that were on Catalog tabs before ADR-0021, by hash: their Presets tab. */
export const PRESET_TABLES: Record<string, "printer" | "process" | "filament"> = {
  "machine-presets": "printer",
  "process-presets": "process",
  "filament-presets": "filament",
};

// Written out so `pnpm i18n:check` sees the keys.
const INTRO = {
  printers: "catalog:intro.printers",
  filament: "catalog:intro.filament",
} as const;

/** Brands, models and materials (ADR-0020, ADR-0021), one tab per part. Needs `catalog` read. */
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
      <p className="mb-8 max-w-prose text-muted">{t(INTRO[tab])}</p>
      <div className="grid gap-10">{tab === "printers" ? <Catalog /> : <FilamentCatalog />}</div>
    </>
  );
}
