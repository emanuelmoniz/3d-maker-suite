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
import { archiveColumn } from "../../components/ArchiveActions.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Write } from "../../components/Write.tsx";
import { useCan } from "../../lib/auth.ts";
import {
  type CatalogKind,
  catalogModule,
  imageUrl,
  useBrands,
  useCatalogWithArchived,
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

export function Section<T extends { id: string; archivedAt: string | null }>(props: {
  kind: CatalogKind;
  title: string;
  /** The row's name in its Archive and Delete buttons and dialogs. */
  name: (row: T) => string;
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
          <Write can={catalogModule(props.kind)} level="manage">
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
          server={{
            query,
            onQueryChange: setQuery,
            total: data.total,
            filters: props.filters,
            archivable: true,
          }}
          columns={[
            ...props.columns,
            archiveColumn<T>(t, {
              kind: props.kind,
              can: catalogModule(props.kind),
              level: "manage",
              name: props.name,
            }),
          ]}
        />
      )}
    </section>
  );
}

/** Name cell: a link to the edit form, or plain text for roles that can't edit. */
function EditLink({ to, id, children }: { to: string; id: string; children: ReactNode }) {
  return useCan(to.startsWith("/filament") ? "filament" : "printers", "manage") ? (
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
  // An active model keeps naming its brand once that is archived.
  const brandOf = new Map(useCatalogWithArchived("brands").data?.map((b) => [b.id, b]));
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
  const slicerName = (l: string) => t(`filament:library.sources.${l}`, { defaultValue: l });
  const slicers = (libs: Iterable<string | null>) => {
    const names = [...new Set([...libs].filter((l): l is string => !!l))].map(slicerName).sort();
    return names.length ? formatList(names) : none;
  };
  // The slicers to filter by are those the profiles came from.
  const slicerOptions = [
    ...new Set([...machineProfiles, ...printProfiles].map((p) => libraryOf(p.sourcePreset))),
  ]
    .filter((l): l is string => !!l)
    .map((l) => ({ value: l, label: slicerName(l) }));
  const slicerColumn = <T,>(
    libs: (row: T) => Iterable<string | null>,
    filterable = true,
  ): Column<T> => ({
    id: "slicer",
    header: t("printers:catalog.slicer"),
    cell: (r) => slicers(libs(r)),
    ...(filterable && { filter: "slicer", filterOptions: slicerOptions }),
  });
  const brandColumn = <T,>(modelId: (row: T) => string | null): Column<T> => ({
    id: "brand",
    header: t("printers:catalog.models.brand"),
    cell: (r) => info.get(modelId(r) ?? "")?.brand?.name ?? none,
    filter: "brandId",
    filterOptions: brands.map((b) => ({ value: b.id, label: b.name })),
  });

  return (
    <div className="mt-8 grid gap-8">
      <Section<Brand>
        kind="brands"
        title={t("printers:catalog.brands.title")}
        name={(b) => b.name}
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
          slicerColumn<Brand>((b) => brandLibraries(b.id), false),
        ]}
      />
      <Section<PrinterModel>
        kind="printer-models"
        title={t("printers:catalog.models.title")}
        name={(m) => info.get(m.id)?.label ?? m.model}
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
        name={(p) => p.name}
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
          brandColumn<MachineProfile>((p) => p.printerModelId),
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
        name={(p) => p.name}
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
          brandColumn<PrintProfile>((p) => p.printerModelId),
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
