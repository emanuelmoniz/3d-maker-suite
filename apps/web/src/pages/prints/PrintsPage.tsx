import { PRINT_OUTCOMES, printFilters } from "@3d-maker-suite/core";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ExternalLink, Layers, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { CostBreakdown } from "../../components/CostBreakdown.tsx";
import { DataTable, type ListQuery } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagList } from "../../components/TagList.tsx";
import { useMoney } from "../../lib/cost.ts";
import { formatDateTime, formatDuration, formatWeight } from "../../lib/format.ts";
import { usePrinters } from "../../lib/printers.ts";
import { useDeletePrint, useFilamentReview, usePrints } from "../../lib/prints.ts";
import { useTags, useTagsOf } from "../../lib/tags.ts";

const OUTCOMES = {
  success: "prints:outcomes.success",
  failed: "prints:outcomes.failed",
  cancelled: "prints:outcomes.cancelled",
} as const;

export function PrintsPage() {
  const { t } = useTranslation();
  const money = useMoney();
  // The URL search params are the API list query, so a link reproduces the same view.
  const query = useSearch({ strict: false }) as ListQuery;
  const navigate = useNavigate();
  const setQuery = (search: ListQuery) => navigate({ to: "/prints", search });
  const { data, isError } = usePrints(query);
  const tagsOf = useTagsOf("print");
  const tags = useTags().data ?? [];
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const waiting = useFilamentReview().data?.length ?? 0;
  const del = useDeletePrint();
  const [toDelete, setToDelete] = useState<{ id: string; title: string } | null>(null);
  const grams = (p: { usages: { grams: number }[] }) => p.usages.reduce((n, u) => n + u.grams, 0);
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
        actions={add}
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
        data && (
          <DataTable
            label={t("prints:list.table")}
            rows={data.items}
            rowKey={(p) => p.id}
            server={{
              query,
              onQueryChange: setQuery,
              total: data.total,
              filters: printFilters,
              defaultSort: "-startedAt",
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
                    <span className="font-medium">{p.title}</span>
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
                cell: (p) => printers.find((x) => x.id === p.printerId)?.name ?? "",
                filter: "printerId",
                filterOptions: printers.map((x) => ({ value: x.id, label: x.name })),
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
                cell: (p) => (p.durationSec == null ? "" : formatDuration(p.durationSec)),
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
              {
                id: "actions",
                header: "",
                cell: (p) => (
                  <span className="flex items-center justify-end gap-3">
                    <Link to="/prints/$id/edit" params={{ id: p.id }} className="hover:underline">
                      {t("prints:list.edit")}
                    </Link>
                    <Button variant="ghost" onClick={() => setToDelete(p)}>
                      {t("prints:list.delete")}
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        )
      )}
      <ConfirmDialog
        open={!!toDelete}
        destructive
        title={t("prints:delete.title")}
        description={t("prints:delete.body", { title: toDelete?.title })}
        confirmLabel={t("prints:delete.confirm")}
        onCancel={() => setToDelete(null)}
        onConfirm={() =>
          toDelete && del.mutate(toDelete.id, { onSettled: () => setToDelete(null) })
        }
      />
    </>
  );
}
