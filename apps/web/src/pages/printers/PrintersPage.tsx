import { type Printer, printerFilters } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Printer as PrinterIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { SyncButtons } from "../../components/ImportLinks.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagList } from "../../components/TagList.tsx";
import { useModelInfo } from "../../lib/catalog.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useTags, useTagsOf } from "../../lib/tags.ts";
import { addClass, Catalog } from "./Catalog.tsx";
import { StateBadge, useStateLabel } from "./StateBadge.tsx";

export function PrintersPage() {
  const { t } = useTranslation();
  const stateLabel = useStateLabel();
  const states = usePreferences().data?.values.printerStates ?? [];
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = useListPage<Printer>(["printers", "list"], "/api/printers", query);
  const tagsOf = useTagsOf("printer");
  const tags = useTags().data ?? [];
  const models = useModelInfo();

  const add = (
    <span className="flex flex-wrap gap-2">
      <SyncButtons cap="printers" text="integrations:printersImport.link" />
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
        actions={add}
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("printers:loadError")}
        </p>
      )}
      {data && !data.total && !Object.keys(query).length ? (
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
                    {p.name}
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
      <Catalog />
    </>
  );
}
