import {
  type FilamentBrand,
  type FilamentMaterial,
  filamentCatalogFilters,
} from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import type { Column } from "../../components/DataTable.tsx";
import { imageUrl, useFilamentBrands, useFilamentMaterials } from "../../lib/catalog.ts";
import { textLink } from "../../lib/cx.ts";
import { useFilamentPresets } from "../../lib/filament.ts";
import { formatCurrency, formatList } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { sourceColumn } from "../catalog/sources.tsx";
import { editLink, Section, Thumb } from "../printers/Catalog.tsx";

// The slicer library a preset came from (`<library>:<preset>`); hand-made ones have none.
const libraryOf = (source: string | null) => source?.split(":")[0] || null;

/** Slicer columns for brands and materials, worked out from their presets' presets. */
function useSlicerColumns() {
  const { t } = useTranslation();
  const presets = useFilamentPresets().data?.items ?? [];
  const column = <T,>(libs: (row: T) => (string | null)[]): Column<T> => ({
    id: "slicer",
    header: t("filament:catalog.slicer"),
    cell: (r) => {
      const names = [...new Set(libs(r).filter((l): l is string => !!l))]
        .map((l) => t(`filament:library.sources.${l}`, { defaultValue: l }))
        .sort();
      return names.length ? formatList(names) : t("printers:detail.info.none");
    },
  });
  // Brands and materials have no preset of their own: theirs are their presets' slicers.
  return {
    brand: column<FilamentBrand>((b) =>
      presets.filter((p) => p.brandId === b.id).map((p) => libraryOf(p.sourcePreset)),
    ),
    material: column<FilamentMaterial>((m) =>
      presets.filter((p) => p.materialId === m.id).map((p) => libraryOf(p.sourcePreset)),
    ),
  };
}

/** Filament brands and materials. */
export function FilamentCatalog() {
  const { t } = useTranslation();
  const currency = usePreferences().data?.values.currency;
  const none = t("printers:detail.info.none");
  const slicer = useSlicerColumns();
  const brands = useFilamentBrands().data ?? [];
  const materials = useFilamentMaterials().data ?? [];
  return (
    <>
      <Section<FilamentBrand>
        kind="filament-brands"
        title={t("filament:catalog.brands.title")}
        name={(b) => b.name}
        add={{ to: "/filament/brands/new", label: t("filament:catalog.brands.add") }}
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
                <a href={b.url} target="_blank" rel="noreferrer" className={textLink}>
                  {new URL(b.url).host}
                </a>
              ) : (
                none
              ),
          },
          slicer.brand,
          sourceColumn<FilamentBrand>(t, brands),
        ]}
      />
      <Section<FilamentMaterial>
        kind="filament-materials"
        title={t("filament:catalog.materials.title")}
        name={(m) => m.name}
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
            header: `${t("filament:presets.nozzleTemp")} / ${t("filament:presets.bedTemp")}`,
            cell: (m) =>
              m.nozzleTempC === null && m.bedTempC === null
                ? none
                : t("filament:presets.temps", {
                    nozzle: m.nozzleTempC ?? "–",
                    bed: m.bedTempC ?? "–",
                  }),
          },
          {
            id: "price",
            header: t("filament:catalog.materials.pricePerKg"),
            numeric: true,
            cell: (m) =>
              m.pricePerKg === null ? none : formatCurrency(m.pricePerKg / 100, currency),
          },
          slicer.material,
          sourceColumn<FilamentMaterial>(t, materials),
        ]}
      />
    </>
  );
}
