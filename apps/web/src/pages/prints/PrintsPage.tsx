import { Link } from "@tanstack/react-router";
import { ExternalLink, Layers, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagFilter } from "../../components/TagFilter.tsx";
import { TagList } from "../../components/TagList.tsx";
import { formatDateTime, formatDuration, formatWeight } from "../../lib/format.ts";
import { usePrinters } from "../../lib/printers.ts";
import { useDeletePrint, useFilamentReview, usePrints } from "../../lib/prints.ts";
import { useTagsOf } from "../../lib/tags.ts";

const OUTCOMES = {
  success: "prints:outcomes.success",
  failed: "prints:outcomes.failed",
  cancelled: "prints:outcomes.cancelled",
} as const;

export function PrintsPage() {
  const { t } = useTranslation();
  const [tagId, setTagId] = useState("");
  const { data, isError } = usePrints(tagId);
  const tagsOf = useTagsOf("print");
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
        <p role="alert" className="text-bad">
          {t("prints:loadError")}
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
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <TagFilter value={tagId} onChange={setTagId} />
      </div>
      {data && !data.total && !tagId ? (
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
                sortValue: (p) => p.title.toLowerCase(),
              },
              {
                id: "startedAt",
                header: t("prints:list.columns.startedAt"),
                cell: (p) => formatDateTime(p.startedAt),
                sortValue: (p) => p.startedAt,
              },
              {
                id: "printer",
                header: t("prints:list.columns.printer"),
                cell: (p) => printers.find((x) => x.id === p.printerId)?.name ?? "",
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
                sortValue: (p) => p.outcome,
              },
              {
                id: "tags",
                header: t("tags:column"),
                cell: (p) => <TagList tags={tagsOf(p.id)} />,
              },
              {
                id: "duration",
                header: t("prints:list.columns.duration"),
                numeric: true,
                cell: (p) => (p.durationSec == null ? "" : formatDuration(p.durationSec)),
                sortValue: (p) => p.durationSec ?? 0,
              },
              {
                id: "filament",
                header: t("prints:list.columns.filament"),
                numeric: true,
                cell: (p) => formatWeight(grams(p)),
                sortValue: grams,
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
