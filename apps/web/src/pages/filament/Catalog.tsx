import {
  type FilamentBrand,
  type FilamentMaterial,
  type FilamentProfile,
  filamentCatalogFilters,
  filamentProfileFilters,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { ImportLinks } from "../../components/ImportLinks.tsx";
import { Write } from "../../components/Write.tsx";
import { imageUrl, useFilamentBrands, useFilamentMaterials } from "../../lib/catalog.ts";
import { filamentLabel } from "../../lib/filament.ts";
import { formatCurrency } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { addClass, editLink, Section, Thumb } from "../printers/Catalog.tsx";

/** Filament brands and materials. */
export function FilamentCatalog() {
  const { t } = useTranslation();
  const none = t("printers:detail.info.none");
  return (
    <>
      <Section<FilamentBrand>
        kind="filament-brands"
        title={t("filament:catalog.brands.title")}
        add={{ to: "/filament/brands/new", label: t("filament:catalog.brands.add") }}
        extra={
          <ImportLinks cap="filamentBrands" text="integrations:catalogImport.link.filamentBrands" />
        }
        filters={filamentCatalogFilters}
        columns={[
          {
            id: "name",
            header: t("filament:catalog.brands.name"),
            cell: (b) =>
              editLink(
                "/filament/brands/$id/edit",
                b.id,
                <>
                  <Thumb src={b.logoPath && imageUrl("filament-brands", b)} />
                  {b.name}
                </>,
              ),
            sort: "name",
            filter: "name",
          },
          {
            id: "url",
            header: t("filament:catalog.brands.url"),
            cell: (b) =>
              b.url ? (
                <a href={b.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {new URL(b.url).host}
                </a>
              ) : (
                none
              ),
          },
        ]}
      />
      <Section<FilamentMaterial>
        kind="filament-materials"
        title={t("filament:catalog.materials.title")}
        add={{ to: "/filament/materials/new", label: t("filament:catalog.materials.add") }}
        extra={
          <ImportLinks
            cap="filamentMaterials"
            text="integrations:catalogImport.link.filamentMaterials"
          />
        }
        filters={filamentCatalogFilters}
        columns={[
          {
            id: "name",
            header: t("filament:catalog.materials.name"),
            cell: (m) => editLink("/filament/materials/$id/edit", m.id, m.name),
            sort: "name",
            filter: "name",
          },
          {
            id: "temps",
            header: `${t("filament:profiles.nozzleTemp")} / ${t("filament:profiles.bedTemp")}`,
            cell: (m) =>
              m.nozzleTempC === null && m.bedTempC === null
                ? none
                : t("filament:profiles.temps", {
                    nozzle: m.nozzleTempC ?? "–",
                    bed: m.bedTempC ?? "–",
                  }),
          },
        ]}
      />
    </>
  );
}

/** Filament profiles table with its import and add actions. */
export function FilamentProfiles() {
  const { t } = useTranslation();
  const prefs = usePreferences().data?.values;
  const [profileQuery, setProfileQuery] = useUrlListQuery("profiles.");
  const profiles = useListPage<FilamentProfile>(
    ["filament", "profiles", "table"],
    "/api/filament/profiles",
    profileQuery,
  );
  const brands = useFilamentBrands().data ?? [];
  const materials = useFilamentMaterials().data ?? [];
  return (
    <>
      {profiles.isError && (
        <p role="alert" className="text-bad">
          {t("filament:loadError")}
        </p>
      )}
      <section id="filament-profiles" className="grid scroll-mt-4 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t("filament:profiles.title")}</h2>
          <span className="flex flex-wrap gap-2">
            <ImportLinks cap="filamentProfiles" text="filament:library.link" />
            <Write admin>
              <Link to="/filament/profiles/new" className={addClass}>
                <Plus className="size-4" aria-hidden />
                {t("filament:profiles.add")}
              </Link>
            </Write>
          </span>
        </div>
        {profiles.data && (
          <DataTable
            label={t("filament:profiles.table")}
            rows={profiles.data.items}
            rowKey={(p) => p.id}
            server={{
              query: profileQuery,
              onQueryChange: setProfileQuery,
              total: profiles.data.total,
              filters: filamentProfileFilters,
              archivable: true,
            }}
            columns={[
              {
                id: "name",
                header: t("filament:spools.filament"),
                cell: (p) => (
                  <Link
                    to="/filament/profiles/$id"
                    params={{ id: p.id }}
                    className="font-medium hover:underline"
                  >
                    {filamentLabel(p)}
                  </Link>
                ),
                sort: "filament",
                filter: "filament",
              },
              {
                id: "brand",
                header: t("filament:profiles.brand"),
                cell: (p) => p.brand,
                sort: "brand",
                filter: "brandId",
                filterOptions: brands.map((b) => ({ value: b.id, label: b.name })),
              },
              {
                id: "material",
                header: t("filament:profiles.material"),
                cell: (p) => p.material,
                sort: "material",
                filter: "materialId",
                filterOptions: materials.map((m) => ({ value: m.id, label: m.name })),
              },
              {
                id: "temps",
                header: `${t("filament:profiles.nozzleTemp")} / ${t("filament:profiles.bedTemp")}`,
                cell: (p) =>
                  p.nozzleTempC === null && p.bedTempC === null
                    ? ""
                    : t("filament:profiles.temps", {
                        nozzle: p.nozzleTempC ?? "–",
                        bed: p.bedTempC ?? "–",
                      }),
              },
              {
                id: "price",
                header: t("filament:profiles.pricePerKg"),
                numeric: true,
                cell: (p) =>
                  p.pricePerKg === null ? "" : formatCurrency(p.pricePerKg / 100, prefs?.currency),
                sort: "pricePerKg",
                filter: "pricePerKg",
                filterScale: 100,
                filterHint: prefs?.currency,
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
