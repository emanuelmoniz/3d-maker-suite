import {
  type Brand,
  brandFilters,
  type ColumnFilter,
  type PrinterModel,
  printerModelFilters,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { archiveColumn } from "../../components/ArchiveActions.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Write } from "../../components/Write.tsx";
import { useCan } from "../../lib/auth.ts";
import {
  type CatalogKind,
  imageUrl,
  useBrands,
  useCatalogWithArchived,
  useMachinePresets,
  useModelInfo,
  usePrinterModels,
  useProcessPresets,
} from "../../lib/catalog.ts";
import { formatList } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { CatalogTransfer } from "../catalog/CatalogTransfer.tsx";
import { sourceColumn } from "../catalog/sources.tsx";

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
  /** None: rows only come from a slicer's files (presets, ADR-0020). */
  add?: { to: string; label: string };
  /** Import links, next to the add button. */
  extra?: ReactNode;
  /** One line under the title: where its rows come from. */
  intro?: string;
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
  useScrolledTo(props.kind, !!data);
  return (
    <section id={props.kind} className="grid scroll-mt-4 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{props.title}</h2>
        <span className="flex flex-wrap gap-2">
          {props.extra}
          {props.add && (
            <Write can="catalog" level="manage">
              <Link to={props.add.to} className={addClass}>
                <Plus className="size-4" aria-hidden />
                {props.add.label}
              </Link>
            </Write>
          )}
        </span>
      </div>
      {props.intro && <p className="-mt-1 text-muted">{props.intro}</p>}
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
              can: props.kind.endsWith("-presets") ? "presets" : "catalog",
              level: "manage",
              name: props.name,
            }),
          ]}
        />
      )}
    </section>
  );
}

/** A link to `#<id>` lands on that table once it is in, too late for the browser's own jump. */
export function useScrolledTo(id: string, loaded: boolean) {
  useEffect(() => {
    if (loaded && location.hash === `#${id}`) document.getElementById(id)?.scrollIntoView();
  }, [id, loaded]);
}

/** Name cell: a link to the edit form, or plain text for roles that can't edit. */
function EditLink({ to, id, children }: { to: string; id: string; children: ReactNode }) {
  return useCan("catalog", "manage") ? (
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

/** Brands and printer models: Catalog → Printers. */
export function Catalog() {
  const { t } = useTranslation();
  const brands = useBrands().data ?? [];
  const models = usePrinterModels().data ?? [];
  const info = useModelInfo();
  const machinePresets = useMachinePresets().data ?? [];
  const processPresets = useProcessPresets().data ?? [];
  // An active model keeps naming its brand once that is archived.
  const brandOf = new Map(useCatalogWithArchived("brands").data?.map((b) => [b.id, b]));
  const none = t("printers:detail.info.none");

  // The slicer library a preset came from (`<library>:<preset>`); hand-made ones have none.
  // Brands and models have no preset of their own: theirs are their presets' slicers.
  const libraryOf = (source: string | null) => source?.split(":")[0] || null;
  const modelLibraries = new Map<string, Set<string>>();
  for (const p of [...machinePresets, ...processPresets]) {
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
  // The slicers to filter brands and models by are those their presets came from.
  const slicerOptions = [
    ...new Set([...machinePresets, ...processPresets].map((p) => libraryOf(p.sourcePreset))),
  ]
    .filter((l): l is string => !!l)
    .map((l) => ({ value: l, label: slicerName(l) }));
  const slicerColumn = <T,>(libs: (row: T) => Iterable<string | null>): Column<T> => ({
    id: "slicer",
    header: t("printers:catalog.slicer"),
    cell: (r) => slicers(libs(r)),
    sort: "slicer",
    filter: "slicer",
    filterOptions: slicerOptions,
  });

  return (
    <div className="grid gap-10">
      <Section<Brand>
        kind="brands"
        title={t("printers:catalog.brands.title")}
        name={(b) => b.name}
        add={{ to: "/printers/brands/new", label: t("printers:catalog.brands.add") }}
        extra={<CatalogTransfer entity="brands" />}
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
          sourceColumn<Brand>(t, brands),
        ]}
      />
      <Section<PrinterModel>
        kind="printer-models"
        title={t("printers:catalog.models.title")}
        name={(m) => info.get(m.id)?.label ?? m.model}
        add={{ to: "/printers/models/new", label: t("printers:catalog.models.add") }}
        extra={<CatalogTransfer entity="printerModels" />}
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
          sourceColumn<PrinterModel>(t, models),
        ]}
      />
    </div>
  );
}
