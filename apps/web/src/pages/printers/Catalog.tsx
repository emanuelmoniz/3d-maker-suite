import {
  type Brand,
  brandFilters,
  type ColumnFilter,
  type MachineProfile,
  machineProfileFilters,
  type PrinterModel,
  printerModelFilters,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import {
  type CatalogKind,
  imageUrl,
  useBrands,
  useModelInfo,
  usePrinterModels,
} from "../../lib/catalog.ts";
import { formatNumber } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";

export const addClass =
  "inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

/** Small square image (logo / model picture), or nothing. */
export function Thumb({ src }: { src: string | null }) {
  return src ? <img src={src} alt="" className="size-6 shrink-0 rounded object-contain" /> : null;
}

export function Section<T extends { id: string }>(props: {
  kind: CatalogKind;
  title: string;
  add: { to: string; label: string };
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
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{props.title}</h2>
        <Link to={props.add.to} className={addClass}>
          <Plus className="size-4" aria-hidden />
          {props.add.label}
        </Link>
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

export const editLink = (to: string, id: string, children: ReactNode) => (
  <Link to={to} params={{ id }} className="gap-2 font-medium hover:underline">
    {children}
  </Link>
);

/** Brands, printer models and machine profiles, below the printers table. */
export function Catalog() {
  const { t } = useTranslation();
  const brands = useBrands().data ?? [];
  const models = usePrinterModels().data ?? [];
  const info = useModelInfo();
  const brandOf = new Map(brands.map((b) => [b.id, b]));
  const none = t("printers:detail.info.none");

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
        ]}
      />
    </div>
  );
}
