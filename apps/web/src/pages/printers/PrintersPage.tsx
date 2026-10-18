import {
  type Accessory,
  accessoryFilters,
  type Printer,
  printerFilters,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Printer as PrinterIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { SyncButtons } from "../../components/ImportLinks.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { TagList } from "../../components/TagList.tsx";
import { accessoryName } from "../../lib/accessories.ts";
import { useModelInfo } from "../../lib/catalog.ts";
import { formatDuration, formatNumber } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { printerName, usePrinters } from "../../lib/printers.ts";
import { useTags, useTagsOf } from "../../lib/tags.ts";
import { addClass } from "./Catalog.tsx";
import { StateBadge, useStateLabel } from "./StateBadge.tsx";

export function PrintersPage() {
  const { t } = useTranslation();
  const stateLabel = useStateLabel();
  const states = usePreferences().data?.values.printerStates ?? [];
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = useListPage<Printer>(["printers", "list"], "/api/printers", query);
  // Archived printers keep the table (and its "Show archived" switch) up, even with no active ones.
  const archived = useListPage<Printer>(["printers", "list"], "/api/printers", {
    archived: "true",
    pageSize: "1",
  });
  const tagsOf = useTagsOf("printer");
  const tags = useTags().data ?? [];
  const models = useModelInfo();

  const add = (
    <span className="flex flex-wrap gap-2">
      <SyncButtons cap="printers" />
      <Link to="/printers/new" className={addClass}>
        <Plus className="size-4" aria-hidden />
        {t("printers:list.add")}
      </Link>
    </span>
  );

  return (
    <>
      <PageHeader
        title={t("nav:items.printers.label")}
        description={t("nav:items.printers.description")}
        actions={
          <>
            {add}
            <SettingsLink module="printers" />
          </>
        }
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("printers:loadError")}
        </p>
      )}
      {data && !data.total && !Object.keys(query).length && archived.data?.total === 0 ? (
        <EmptyState
          icon={PrinterIcon}
          title={t("printers:list.emptyTitle")}
          description={t("printers:list.emptyBody")}
          action={add}
        />
      ) : (
        data && (
          <DataTable
            label={t("printers:list.table")}
            rows={data.items}
            rowKey={(p) => p.id}
            server={{
              query,
              onQueryChange: setQuery,
              total: data.total,
              filters: printerFilters,
              archivable: true,
            }}
            columns={[
              {
                id: "name",
                header: t("printers:list.columns.name"),
                cell: (p) => (
                  <Link
                    to="/printers/$id"
                    params={{ id: p.id }}
                    className="font-medium hover:underline"
                  >
                    {printerName(t, p)}
                  </Link>
                ),
                sort: "name",
                filter: "name",
              },
              {
                id: "model",
                header: t("printers:list.columns.model"),
                cell: (p) => models.get(p.modelId)?.label,
                sort: "model",
                filter: "model",
              },
              {
                id: "state",
                header: t("printers:list.columns.state"),
                cell: (p) => <StateBadge state={p.state} />,
                sort: "state",
                filter: "state",
                filterOptions: states.map((s) => ({ value: s, label: stateLabel(s) })),
              },
              {
                id: "tags",
                header: t("tags:column"),
                cell: (p) => <TagList tags={tagsOf(p.id)} />,
                filter: "tagId",
                filterOptions: tags.map((x) => ({ value: x.id, label: x.name })),
              },
              {
                id: "power",
                header: t("printers:list.columns.power"),
                numeric: true,
                cell: (p) =>
                  p.powerW === null
                    ? ""
                    : t("printers:detail.info.powerValue", { value: p.powerW }),
                sort: "powerW",
                filter: "powerW",
              },
            ]}
          />
        )
      )}
      <AccessoriesTable />
    </>
  );
}

/** Below the printers: every accessory and the printer it is on. */
function AccessoriesTable() {
  const { t } = useTranslation();
  const stateLabel = useStateLabel();
  const states = usePreferences().data?.values.printerStates ?? [];
  const [query, setQuery] = useUrlListQuery("accessories.");
  const { data } = useListPage<Accessory>(["accessories", "list"], "/api/accessories", query);
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const printerOf = new Map(printers.map((p) => [p.id, p]));
  const tagsOf = useTagsOf("accessory");
  const tags = useTags().data ?? [];

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("printers:accessories.title")}</h2>
        <Link to="/printers/accessories/new" className={addClass}>
          <Plus className="size-4" aria-hidden />
          {t("printers:accessories.add")}
        </Link>
      </div>
      {data && !data.total && !Object.keys(query).length ? (
        <p className="text-muted">{t("printers:accessories.empty")}</p>
      ) : (
        data && (
          <DataTable
            label={t("printers:accessories.table")}
            rows={data.items}
            rowKey={(a) => a.id}
            server={{
              query,
              onQueryChange: setQuery,
              total: data.total,
              filters: accessoryFilters,
              archivable: true,
            }}
            columns={[
              {
                id: "name",
                header: t("printers:accessories.columns.name"),
                cell: (a) => (
                  <Link
                    to="/printers/accessories/$id"
                    params={{ id: a.id }}
                    className="font-medium hover:underline"
                  >
                    {accessoryName(t, a)}
                  </Link>
                ),
                sort: "name",
                filter: "name",
              },
              {
                id: "type",
                header: t("printers:accessories.columns.type"),
                cell: (a) => a.type,
                sort: "type",
                filter: "type",
              },
              {
                id: "state",
                header: t("printers:accessories.columns.state"),
                cell: (a) => <StateBadge state={a.state} />,
                sort: "state",
                filter: "state",
                filterOptions: states.map((s) => ({ value: s, label: stateLabel(s) })),
              },
              {
                id: "tags",
                header: t("tags:column"),
                cell: (a) => <TagList tags={tagsOf(a.id)} />,
                filter: "tagId",
                filterOptions: tags.map((x) => ({ value: x.id, label: x.name })),
              },
              {
                id: "printer",
                header: t("printers:accessories.columns.printer"),
                cell: (a) => {
                  const p = a.printerId && printerOf.get(a.printerId);
                  return (
                    p && (
                      <Link to="/printers/$id" params={{ id: p.id }} className="hover:underline">
                        {printerName(t, p)}
                      </Link>
                    )
                  );
                },
                sort: "printer",
                filter: "printerId",
                filterOptions: printers.map((p) => ({ value: p.id, label: printerName(t, p) })),
              },
              {
                id: "prints",
                header: t("printers:detail.stats.prints"),
                numeric: true,
                cell: (a) => formatNumber(a.prints),
                sort: "prints",
                filter: "prints",
              },
              {
                id: "runtime",
                header: t("printers:detail.stats.time"),
                numeric: true,
                cell: (a) => formatDuration(a.runtimeSec),
                sort: "runtimeSec",
              },
              {
                id: "power",
                header: t("printers:list.columns.power"),
                numeric: true,
                cell: (a) =>
                  a.powerW === null
                    ? ""
                    : t("printers:detail.info.powerValue", { value: a.powerW }),
                sort: "powerW",
                filter: "powerW",
              },
            ]}
          />
        )
      )}
    </section>
  );
}
