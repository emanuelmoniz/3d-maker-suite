import {
  type FilamentBrand,
  type FilamentMaterial,
  filamentCatalogFilters,
} from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { ImportLinks } from "../../components/ImportLinks.tsx";
import { imageUrl } from "../../lib/catalog.ts";
import { editLink, Section, Thumb } from "../printers/Catalog.tsx";

/** Filament brands and materials, below the profiles table. */
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
