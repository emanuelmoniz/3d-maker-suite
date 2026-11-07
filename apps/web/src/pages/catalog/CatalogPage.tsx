import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { meQuery, useCan } from "../../lib/auth.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { FilamentCatalog, FilamentProfiles } from "../filament/Catalog.tsx";
import { PresetsTab } from "../hub/PresetsPage.tsx";
import { Catalog } from "../printers/Catalog.tsx";
import { ProfilesHint } from "./ProfilesHint.tsx";

export const CATALOG_TABS = ["printers", "filament", "presets"] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

/** The tables of Catalog → Printers: their old `/printers/settings#<id>` lands on them. */
export const PRINTER_TABLES = ["brands", "printer-models", "machine-profiles", "print-profiles"];

// Written out so `pnpm i18n:check` sees the keys.
const INTRO = {
  printers: "catalog:intro.printers",
  filament: "catalog:intro.filament",
  presets: "catalog:intro.presets",
} as const;

const tabClass =
  "-mb-px inline-flex min-h-10 items-center border-b-2 border-transparent px-1 font-medium text-muted hover:text-fg data-[status=active]:border-accent data-[status=active]:text-fg";

/** The catalog and where it comes from (ADR-0020), one tab per part. Needs `catalog` read. */
export function CatalogPage({ tab }: { tab: CatalogTab }) {
  const { t } = useTranslation();
  const allowed = useCan("catalog", "read");
  const prefs = usePreferences().data;
  const hub = !!prefs?.values.hubEnabled;
  if (!useQuery(meQuery).data) return null;
  if (!allowed) return <Navigate to="/" replace />;
  // Presets are the hub's library: without the hub there is no tab.
  if (tab === "presets" && prefs && !hub) return <Navigate to="/catalog/printers" replace />;
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
        {hub && (
          <Link to="/catalog/presets" className={tabClass}>
            {t("catalog:tabs.presets")}
          </Link>
        )}
      </nav>
      <p className="mb-8 max-w-prose text-muted">{t(INTRO[tab])}</p>
      <div className="grid gap-10">
        {tab === "presets" ? (
          <PresetsTab />
        ) : tab === "printers" ? (
          <Catalog />
        ) : (
          <>
            <FilamentCatalog />
            <FilamentProfiles />
          </>
        )}
        {tab !== "presets" && <ProfilesHint />}
      </div>
    </>
  );
}
