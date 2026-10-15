import { type Page, PRINT_OUTCOMES, type PrintDetail, printFilters } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Layers, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { CostBreakdown } from "../../components/CostBreakdown.tsx";
import { DataTable, type ListQuery } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { SyncButtons } from "../../components/ImportLinks.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { TagList } from "../../components/TagList.tsx";
import { useMoney } from "../../lib/cost.ts";
import { formatDateTime, formatWeight } from "../../lib/format.ts";
import { useUrlListQuery } from "../../lib/list.ts";
import { printerName, usePrinters } from "../../lib/printers.ts";
import { printName, useFilamentReview, usePrints } from "../../lib/prints.ts";
import { useTags, useTagsOf } from "../../lib/tags.ts";
import { Duration } from "./Duration.tsx";

const OUTCOMES = {
  success: "prints:outcomes.success",
  failed: "prints:outcomes.failed",
  cancelled: "prints:outcomes.cancelled",
} as const;

/** The prints table: the main list and any other list of prints (a spool's) share it. */
export function PrintsTable({
  data,
  query,
  onQueryChange,
}: {
  data: Page<PrintDetail>;
  query: ListQuery;
  onQueryChange: (q: ListQuery) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const tagsOf = useTagsOf("print");
  const tags = useTags().data ?? [];
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const grams = (p: { usages: { grams: number }[] }) => p.usages.reduce((n, u) => n + u.grams, 0);
  return (
    <DataTable
      label={t("prints:list.table")}
      rows={data.items}
      rowKey={(p) => p.id}
      server={{
        query,
        onQueryChange,
        total: data.total,
        filters: printFilters,
        defaultSort: "-title",
      }}
      columns={[
        {
          id: "title",
          header: t("prints:list.columns.title"),
          cell: (p) => (
            <span className="flex items-center gap-2">
              {p.coverUrl && (
                <img
                  src={p.coverUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="size-8 rounded object-cover"
                  onError={(e) => e.currentTarget.remove()}
                />
              )}
              <Link to="/prints/$id" params={{ id: p.id }} className="font-medium hover:underline">
                {printName(t, p)}
              </Link>
              {p.sourceUrl && (
                <a
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("prints:list.openDesign")}
                  className="text-muted hover:text-fg"
                >
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              )}
            </span>
          ),
          sort: "title",
          filter: "title",
        },
        {
          id: "startedAt",
          header: t("prints:list.columns.startedAt"),
          cell: (p) => formatDateTime(p.startedAt),
          sort: "startedAt",
          filter: "startedAt",
        },
        {
          id: "printer",
          header: t("prints:list.columns.printer"),
          cell: (p) => {
            const printer = printers.find((x) => x.id === p.printerId);
            return printer ? printerName(t, printer) : "";
          },
          filter: "printerId",
          filterOptions: printers.map((x) => ({ value: x.id, label: printerName(t, x) })),
        },
        {
          id: "outcome",
          header: t("prints:list.columns.outcome"),
          cell: (p) => (
            <span className={p.outcome === "success" ? undefined : "text-bad"}>
              {t(OUTCOMES[p.outcome])}
              {p.failureReason && ` · ${p.failureReason}`}
            </span>
          ),
          sort: "outcome",
          filter: "outcome",
          filterOptions: PRINT_OUTCOMES.map((o) => ({ value: o, label: t(OUTCOMES[o]) })),
        },
        {
          id: "tags",
          header: t("tags:column"),
          cell: (p) => <TagList tags={tagsOf(p.id)} />,
          filter: "tagId",
          filterOptions: tags.map((x) => ({ value: x.id, label: x.name })),
        },
        {
          id: "duration",
          header: t("prints:list.columns.duration"),
          numeric: true,
          cell: (p) =>
            p.durationSec == null ? "" : <Duration print={{ ...p, durationSec: p.durationSec }} />,
          sort: "durationSec",
          filter: "durationSec",
          filterScale: 60,
          filterHint: t("prints:list.durationUnit"),
        },
        {
          id: "filament",
          header: t("prints:list.columns.filament"),
          numeric: true,
          cell: (p) => formatWeight(grams(p)),
        },
        {
          id: "cost",
          header: t("prints:list.columns.cost"),
          numeric: true,
          cell: (p) => (
            <details className="text-left">
              <summary className="cursor-pointer text-right tabular-nums">
                {money(p.cost.total)}
              </summary>
              <div className="mt-2 min-w-48">
                <CostBreakdown cost={p.cost} />
              </div>
            </details>
          ),
        },
      ]}
    />
  );
}

export function PrintsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = usePrints(query);
  const waiting = useFilamentReview({ pageSize: "1" }).data?.total ?? 0;
  const add = (
    <Link
      to="/prints/new"
      className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90"
    >
      <Plus className="size-4" aria-hidden />
      {t("prints:list.add")}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t("nav:items.prints.label")}
        description={t("nav:items.prints.description")}
        actions={
          <>
            <SyncButtons cap="prints" />
            {add}
            <SettingsLink module="prints" />
          </>
        }
      />
      {isError && (
        <p role="alert" className="flex flex-wrap items-center gap-3 text-bad">
          {t("prints:loadError")}
          {Object.keys(query).length > 0 && (
            <Button variant="ghost" onClick={() => setQuery({})}>
              {t("common:actions.clear")}
            </Button>
          )}
        </p>
      )}
      {waiting > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 p-3">
          {t("prints:review.banner", { count: waiting })}
          <Link to="/prints/review" className="font-medium underline">
            {t("prints:review.open")}
          </Link>
        </p>
      )}
      {data && !data.total && !Object.keys(query).length ? (
        <EmptyState
          icon={Layers}
          title={t("prints:list.emptyTitle")}
          description={t("prints:list.emptyBody")}
          action={add}
        />
      ) : (
        data && <PrintsTable data={data} query={query} onQueryChange={setQuery} />
      )}
    </>
  );
}
