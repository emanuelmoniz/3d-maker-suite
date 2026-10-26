import {
  type Brand,
  brandFilters,
  type ColumnFilter,
  type MachineProfile,
  machineProfileFilters,
  type PrinterModel,
  type PrintProfile,
  printerModelFilters,
  printProfileFilters,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Write } from "../../components/Write.tsx";
import { useCan } from "../../lib/auth.ts";
import {
  type CatalogKind,
  imageUrl,
  useBrands,
  useMachineProfiles,
  useModelInfo,
  usePrinterModels,
  usePrintProfiles,
} from "../../lib/catalog.ts";
import { formatList, formatNumber } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";

export const addClass =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

/** Small square image (logo / model picture), or nothing. */
export function Thumb({ src }: { src: string | null }) {
  return src ? <img src={src} alt="" className="size-6 shrink-0 rounded object-contain" /> : null;
}

export function Section<T extends { id: string }>(props: {
  kind: CatalogKind;
  title: string;
  add: { to: string; label: string };
  /** Import links, next to the add button. */
  extra?: ReactNode;
  filters: Record<string, ColumnFilter>;
  columns: Column<T>[];
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useUrlListQuery(`${props.kind}.`);
  const { data, isError } = useListPage<T>(
    ["catalog", props.kind, "table"],
    `/api/${props.kind}`,
    query,
  );
  return (
    <section id={props.kind} className="grid scroll-mt-4 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{props.title}</h2>
        <span className="flex flex-wrap gap-2">
          {props.extra}
          <Write admin>
            <Link to={props.add.to} className={addClass}>
              <Plus className="size-4" aria-hidden />
              {props.add.label}
            </Link>
          </Write>
        </span>
      </div>
      {isError && (
        <p role="alert" className="text-bad">
          {t("printers:loadError")}
        </p>
      )}
      {data && (
        <DataTable
          label={props.title}
          rows={data.items}
          rowKey={(r) => r.id}
          server={{ query, onQueryChange: setQuery, total: data.total, filters: props.filters }}
          columns={props.columns}
        />
      )}
    </section>
  );
}

/** Name cell: a link to the edit form, or plain text for roles that can't edit. */
function EditLink({ to, id, children }: { to: string; id: string; children: ReactNode }) {
  return useCan("admin") ? (
    <Link to={to} params={{ id }} className="gap-2 font-medium hover:underline">
      {children}
    </Link>
  ) : (
    <span className="inline-flex gap-2">{children}</span>
  );
}

export const editLink = (to: string, id: string, children: ReactNode) => (
  <EditLink to={to} id={id}>
    {children}
  </EditLink>
);

/** Brands, printer models, machine profiles and print profiles, below the printers table. */
export function Catalog() {
  const { t } = useTranslation();
  const brands = useBrands().data ?? [];
  const models = usePrinterModels().data ?? [];
  const info = useModelInfo();
  const machineProfiles = useMachineProfiles().data ?? [];
  const printProfiles = usePrintProfiles().data ?? [];
  const brandOf = new Map(brands.map((b) => [b.id, b]));
  const none = t("printers:detail.info.none");

  // The slicer library a preset came from (`<library>:<preset>`); hand-made ones have none.
  // Brands and models have no preset of their own: theirs are their profiles' slicers.
  const libraryOf = (source: string | null) => source?.split(":")[0] || null;
  const modelLibraries = new Map<string, Set<string>>();
  for (const p of [...machineProfiles, ...printProfiles]) {
    const lib = libraryOf(p.sourcePreset);
    if (!lib || !p.printerModelId) continue;
    modelLibraries.set(
      p.printerModelId,
      (modelLibraries.get(p.printerModelId) ?? new Set()).add(lib),
    );
  }
  const brandLibraries = (brandId: string) =>
    models
      .filter((m) => m.brandId === brandId)
      .flatMap((m) => [...(modelLibraries.get(m.id) ?? [])]);
  const slicers = (libs: Iterable<string | null>) => {
    const names = [...new Set([...libs].filter((l): l is string => !!l))]
      .map((l) => t(`filament:library.sources.${l}`, { defaultValue: l }))
      .sort();
    return names.length ? formatList(names) : none;
  };
  const slicerColumn = <T,>(libs: (row: T) => Iterable<string | null>): Column<T> => ({
    id: "slicer",
    header: t("printers:catalog.slicer"),
    cell: (r) => slicers(libs(r)),
  });

  return (
    <div className="mt-8 grid gap-8">
      <Section<Brand>
        kind="brands"
        title={t("printers:catalog.brands.title")}
        add={{ to: "/printers/brands/new", label: t("printers:catalog.brands.add") }}
        filters={brandFilters}
        columns={[
          {
            id: "name",
            header: t("printers:catalog.brands.name"),
            cell: (b) =>
              editLink(
                "/printers/brands/$id/edit",
                b.id,
                <>
                  <Thumb src={b.logoPath && imageUrl("brands", b)} />
                  {b.name}
                </>,
              ),
            sort: "name",
            filter: "name",
          },
          {
            id: "url",
            header: t("printers:catalog.brands.url"),
            cell: (b) =>
              b.url ? (
                <a href={b.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {new URL(b.url).host}
                </a>
              ) : (
                none
              ),
          },
          slicerColumn<Brand>((b) => brandLibraries(b.id)),
        ]}
      />
      <Section<PrinterModel>
        kind="printer-models"
        title={t("printers:catalog.models.title")}
        add={{ to: "/printers/models/new", label: t("printers:catalog.models.add") }}
        filters={printerModelFilters}
        columns={[
          {
            id: "model",
            header: t("printers:catalog.models.model"),
            cell: (m) =>
              editLink(
                "/printers/models/$id/edit",
                m.id,
                <>
                  <Thumb src={m.imagePath && imageUrl("printer-models", m)} />
                  {info.get(m.id)?.label ?? m.model}
                </>,
              ),
            sort: "model",
            filter: "model",
          },
          {
            id: "brand",
            header: t("printers:catalog.models.brand"),
            cell: (m) => brandOf.get(m.brandId)?.name,
            sort: "brand",
            filter: "brandId",
            filterOptions: brands.map((b) => ({ value: b.id, label: b.name })),
          },
          {
            id: "power",
            header: t("printers:catalog.models.power"),
            numeric: true,
            cell: (m) =>
              m.powerW === null ? none : t("printers:detail.info.powerValue", { value: m.powerW }),
            sort: "powerW",
            filter: "powerW",
          },
          slicerColumn<PrinterModel>((m) => modelLibraries.get(m.id) ?? []),
        ]}
      />
      <Section<MachineProfile>
        kind="machine-profiles"
        title={t("printers:catalog.profiles.title")}
        add={{ to: "/printers/profiles/new", label: t("printers:catalog.profiles.add") }}
        filters={machineProfileFilters}
        columns={[
          {
            id: "name",
            header: t("printers:catalog.profiles.name"),
            cell: (p) => editLink("/printers/profiles/$id/edit", p.id, p.name),
            sort: "name",
            filter: "name",
          },
          {
            id: "model",
            header: t("printers:catalog.profiles.model"),
            cell: (p) => info.get(p.printerModelId)?.label,
            sort: "model",
            filter: "printerModelId",
            filterOptions: models.map((m) => ({
              value: m.id,
              label: info.get(m.id)?.label ?? m.model,
            })),
          },
          {
            id: "nozzle",
            header: t("printers:catalog.profiles.nozzle"),
            numeric: true,
            cell: (p) => t("printers:catalog.mm", { value: formatNumber(p.nozzleDiameterMm) }),
            sort: "nozzleDiameterMm",
            filter: "nozzleDiameterMm",
          },
          slicerColumn<MachineProfile>((p) => [libraryOf(p.sourcePreset)]),
        ]}
      />
      <Section<PrintProfile>
        kind="print-profiles"
        title={t("printers:catalog.printProfiles.title")}
        add={{ to: "/printers/print-profiles/new", label: t("printers:catalog.printProfiles.add") }}
        filters={printProfileFilters}
        columns={[
          {
            id: "name",
            header: t("printers:catalog.printProfiles.name"),
            cell: (p) => editLink("/printers/print-profiles/$id/edit", p.id, p.name),
            sort: "name",
            filter: "name",
          },
          {
            id: "model",
            header: t("printers:catalog.printProfiles.model"),
            cell: (p) => (p.printerModelId ? info.get(p.printerModelId)?.label : none),
            sort: "model",
            filter: "printerModelId",
            filterOptions: models.map((m) => ({
              value: m.id,
              label: info.get(m.id)?.label ?? m.model,
            })),
          },
          {
            id: "nozzle",
            header: t("printers:catalog.printProfiles.nozzle"),
            numeric: true,
            cell: (p) =>
              p.nozzleDiameterMm === null
                ? none
                : t("printers:catalog.mm", { value: formatNumber(p.nozzleDiameterMm) }),
            sort: "nozzleDiameterMm",
            filter: "nozzleDiameterMm",
          },
          {
            id: "layer",
            header: t("printers:catalog.printProfiles.layer"),
            numeric: true,
            cell: (p) =>
              p.layerHeightMm === null
                ? none
                : t("printers:catalog.mm", { value: formatNumber(p.layerHeightMm) }),
            sort: "layerHeightMm",
            filter: "layerHeightMm",
          },
          slicerColumn<PrintProfile>((p) => [libraryOf(p.sourcePreset)]),
        ]}
      />
    </div>
  );
}
