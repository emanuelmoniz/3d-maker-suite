import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { meQuery, useCan } from "../../lib/auth.ts";
import { FilamentCatalog, FilamentProfiles } from "../filament/Catalog.tsx";
import { Catalog } from "../printers/Catalog.tsx";

export const CATALOG_TABS = ["printers", "filament"] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

/** The tables of Catalog → Printers: their old `/printers/settings#<id>` lands on them. */
export const PRINTER_TABLES = ["brands", "printer-models", "machine-profiles", "print-profiles"];

const tabClass =
  "-mb-px inline-flex min-h-10 items-center border-b-2 border-transparent px-1 font-medium text-muted hover:text-fg data-[status=active]:border-accent data-[status=active]:text-fg";

/** The catalog and where it comes from (ADR-0020), one tab per part. Needs `catalog` read. */
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
      />
      <nav aria-label={t("catalog:tabs.label")} className="mb-6 flex gap-6 border-b border-border">
        <Link to="/catalog/printers" className={tabClass}>
          {t("catalog:tabs.printers")}
        </Link>
        <Link to="/catalog/filament" className={tabClass}>
          {t("catalog:tabs.filament")}
        </Link>
      </nav>
      <p className="mb-8 max-w-prose text-muted">
        {tab === "printers" ? t("catalog:intro.printers") : t("catalog:intro.filament")}
      </p>
      {tab === "printers" ? (
        <Catalog />
      ) : (
        <div className="grid gap-10">
          <FilamentCatalog />
          <FilamentProfiles />
        </div>
      )}
    </>
  );
}
