import {
  type FilamentPreset,
  filamentPresetFilters,
  type MachinePreset,
  machinePresetFilters,
  type ProcessPreset,
  processPresetFilters,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { archiveColumn } from "../../components/ArchiveActions.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import {
  useBrands,
  useFilamentBrands,
  useFilamentMaterials,
  useMachinePresets,
  useModelInfo,
  usePrinterModels,
  useProcessPresets,
} from "../../lib/catalog.ts";
import { filamentLabel, useFilamentPresets } from "../../lib/filament.ts";
import { formatNumber } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { sourceColumn, useColumn } from "../catalog/sources.tsx";
import { Section, useScrolledTo } from "../printers/Catalog.tsx";

/** The printer model and brand columns of the printer and process presets. */
function useModelColumns<T extends { printerModelId: string | null }>(modelHeader: string) {
  const { t } = useTranslation();
  const brands = useBrands().data ?? [];
  const models = usePrinterModels().data ?? [];
  const info = useModelInfo();
  const none = t("printers:detail.info.none");
  const model: Column<T> = {
    id: "model",
    header: modelHeader,
    cell: (p) => (p.printerModelId ? info.get(p.printerModelId)?.label : none),
    sort: "model",
    filter: "printerModelId",
    filterOptions: models.map((m) => ({ value: m.id, label: info.get(m.id)?.label ?? m.model })),
  };
  const brand: Column<T> = {
    id: "brand",
    header: t("printers:catalog.models.brand"),
    cell: (p) => info.get(p.printerModelId ?? "")?.brand?.name ?? none,
    sort: "brand",
    filter: "brandId",
    filterOptions: brands.map((b) => ({ value: b.id, label: b.name })),
  };
  return [model, brand];
}

const mm = (t: TFunction, v: number | null, none: string) =>
  v === null ? none : t("printers:catalog.mm", { value: formatNumber(v) });

/** Presets → Printer: the slicer's machine presets (ADR-0020, ADR-0021). */
export function MachinePresets() {
  const { t } = useTranslation();
  const all = useMachinePresets().data ?? [];
  const none = t("printers:detail.info.none");
  return (
    <Section<MachinePreset>
      kind="machine-presets"
      title={t("printers:catalog.presets.title")}
      name={(p) => p.name}
      intro={t("catalog:fromFiles")}
      filters={machinePresetFilters}
      columns={[
        {
          id: "name",
          header: t("printers:catalog.presets.name"),
          cell: (p) => (
            <Link
              to="/presets/printer/$id"
              params={{ id: p.id }}
              className="font-medium hover:underline"
            >
              {p.name}
            </Link>
          ),
          sort: "name",
          filter: "name",
        },
        ...useModelColumns<MachinePreset>(t("printers:catalog.presets.model")),
        {
          id: "nozzle",
          header: t("printers:catalog.presets.nozzle"),
          numeric: true,
          cell: (p) => mm(t, p.nozzleDiameterMm, none),
          sort: "nozzleDiameterMm",
          filter: "nozzleDiameterMm",
        },
        sourceColumn<MachinePreset>(t, all, true),
        useColumn<MachinePreset>(t),
      ]}
    />
  );
}

/** Presets → Process. */
export function ProcessPresets() {
  const { t } = useTranslation();
  const all = useProcessPresets().data ?? [];
  const none = t("printers:detail.info.none");
  return (
    <Section<ProcessPreset>
      kind="process-presets"
      title={t("printers:catalog.processPresets.title")}
      name={(p) => p.name}
      intro={t("catalog:fromFiles")}
      filters={processPresetFilters}
      columns={[
        {
          id: "name",
          header: t("printers:catalog.processPresets.name"),
          cell: (p) => (
            <Link
              to="/presets/process/$id"
              params={{ id: p.id }}
              className="font-medium hover:underline"
            >
              {p.name}
            </Link>
          ),
          sort: "name",
          filter: "name",
        },
        ...useModelColumns<ProcessPreset>(t("printers:catalog.processPresets.model")),
        {
          id: "nozzle",
          header: t("printers:catalog.processPresets.nozzle"),
          numeric: true,
          cell: (p) => mm(t, p.nozzleDiameterMm, none),
          sort: "nozzleDiameterMm",
          filter: "nozzleDiameterMm",
        },
        {
          id: "layer",
          header: t("printers:catalog.processPresets.layer"),
          numeric: true,
          cell: (p) => mm(t, p.layerHeightMm, none),
          sort: "layerHeightMm",
          filter: "layerHeightMm",
        },
        sourceColumn<ProcessPreset>(t, all, true),
        useColumn<ProcessPreset>(t),
      ]}
    />
  );
}

/** Presets → Filament: slicer files, listed, archived and deleted here (ADR-0020). */
export function FilamentPresets() {
  const { t } = useTranslation();
  const [presetQuery, setPresetQuery] = useUrlListQuery("presets.");
  const presets = useListPage<FilamentPreset>(
    ["filament", "presets", "table"],
    "/api/filament/presets",
    presetQuery,
  );
  const brands = useFilamentBrands().data ?? [];
  const materials = useFilamentMaterials().data ?? [];
  const all = useFilamentPresets().data?.items ?? [];
  useScrolledTo("filament-presets", !!presets.data);
  return (
    <>
      {presets.isError && (
        <p role="alert" className="text-bad">
          {t("filament:loadError")}
        </p>
      )}
      <section id="filament-presets" className="grid scroll-mt-4 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t("filament:presets.title")}</h2>
        </div>
        <p className="-mt-1 text-muted">{t("catalog:fromFiles")}</p>
        {presets.data && (
          <DataTable
            label={t("filament:presets.table")}
            rows={presets.data.items}
            rowKey={(p) => p.id}
            server={{
              query: presetQuery,
              onQueryChange: setPresetQuery,
              total: presets.data.total,
              filters: filamentPresetFilters,
              archivable: true,
            }}
            columns={[
              {
                id: "name",
                header: t("filament:spools.filament"),
                cell: (p) => (
                  <Link
                    to="/presets/filament/$id"
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
                header: t("filament:presets.brand"),
                cell: (p) => p.brand,
                sort: "brand",
                filter: "brandId",
                filterOptions: brands.map((b) => ({ value: b.id, label: b.name })),
              },
              {
                id: "material",
                header: t("filament:presets.material"),
                cell: (p) => p.material,
                sort: "material",
                filter: "materialId",
                filterOptions: materials.map((m) => ({ value: m.id, label: m.name })),
              },
              {
                id: "temps",
                header: `${t("filament:presets.nozzleTemp")} / ${t("filament:presets.bedTemp")}`,
                cell: (p) =>
                  p.nozzleTempC === null && p.bedTempC === null
                    ? ""
                    : t("filament:presets.temps", {
                        nozzle: p.nozzleTempC ?? "–",
                        bed: p.bedTempC ?? "–",
                      }),
              },
              sourceColumn<FilamentPreset>(t, all, true),
              useColumn<FilamentPreset>(t),
              archiveColumn<FilamentPreset>(t, {
                kind: "filament-presets",
                can: "presets",
                level: "manage",
                name: filamentLabel,
              }),
            ]}
          />
        )}
      </section>
    </>
  );
}
