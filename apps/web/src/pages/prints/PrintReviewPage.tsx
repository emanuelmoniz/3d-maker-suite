import { type FilamentReviewItem, filamentReviewFilters, usableOn } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { spoolName, useProfiles, useSpools } from "../../lib/filament.ts";
import { formatDateTime, formatWeight } from "../../lib/format.ts";
import { useUrlListQuery } from "../../lib/list.ts";
import {
  printName,
  useAssignReview,
  useDismissReview,
  useFilamentReview,
} from "../../lib/prints.ts";
import { NewSpoolDialog } from "../filament/NewSpoolDialog.tsx";

/** Imported filament that couldn't be matched to exactly one spool: a person decides. */
export function PrintReviewPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = useFilamentReview(query);
  const items = data?.items;
  // An empty result under a filter is not "all done": the table stays, with its Clear button.
  const filtered = Object.keys(filamentReviewFilters).some((k) => query[k]);
  const spools = (useSpools().data?.items ?? []).filter(
    (s) => !s.archivedAt && s.status !== "empty",
  );
  const profiles = useProfiles().data?.items ?? [];
  const assign = useAssignReview();
  const dismiss = useDismissReview();
  const [picked, setPicked] = useState<Record<string, string>>({});
  // The slot a new spool is being added for.
  const [adding, setAdding] = useState<FilamentReviewItem | null>(null);
  // Spools opened by the print's day; the reported material and colour first, then the material.
  const optionsFor = (i: FilamentReviewItem) =>
    spools
      .filter((s) => usableOn(s, i.startedAt))
      .map((s) => {
        const profile = profiles.find((p) => p.id === s.profileId);
        const material =
          !!i.material && profile?.material.toLowerCase() === i.material.toLowerCase();
        const color = !!i.colorHex && s.colorHex.toLowerCase() === i.colorHex.toLowerCase();
        return { spool: s, profile, rank: Number(material) * (color ? 2 : 1) };
      })
      .sort((a, b) => b.rank - a.rank);

  return (
    <>
      <PageHeader
        title={t("prints:review.title")}
        description={t("prints:review.description")}
        actions={
          <Link to="/prints" className="inline-flex h-9 items-center hover:underline">
            {t("prints:review.back")}
          </Link>
        }
      />
      {(isError || assign.isError || dismiss.isError) && (
        <p role="alert" className="mb-4 text-bad">
          {t(assign.isError ? "prints:review.assignError" : "prints:review.error")}
        </p>
      )}
      {data && !data.total && !filtered ? (
        <EmptyState
          icon={CheckCircle2}
          title={t("prints:review.emptyTitle")}
          description={t("prints:review.emptyBody")}
        />
      ) : (
        data &&
        items && (
          <>
            <div className="mb-3 flex justify-end">
              <Button
                variant="ghost"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(items.map((i) => i.usageId))}
              >
                {t("prints:review.skipAll")}
              </Button>
            </div>
            <DataTable
              label={t("prints:review.table")}
              rows={items}
              rowKey={(i) => i.usageId}
              server={{
                query,
                onQueryChange: setQuery,
                total: data.total,
                filters: filamentReviewFilters,
                defaultSort: "-startedAt",
              }}
              columns={[
                {
                  id: "print",
                  header: t("prints:review.columns.print"),
                  cell: (i) => (
                    <Link
                      to="/prints/$id"
                      params={{ id: i.printId }}
                      className="font-medium hover:underline"
                    >
                      {printName(t, { number: i.printNumber, title: i.printTitle })}
                    </Link>
                  ),
                  sort: "printTitle",
                  filter: "printTitle",
                },
                {
                  id: "startedAt",
                  header: t("prints:review.columns.started"),
                  cell: (i) => formatDateTime(i.startedAt),
                  sort: "startedAt",
                  filter: "startedAt",
                },
                {
                  id: "filament",
                  header: t("prints:review.columns.filament"),
                  cell: (i) => (
                    <span className="inline-flex items-center gap-2">
                      {i.colorHex && (
                        <span
                          aria-hidden
                          className="size-4 rounded-full border border-border"
                          style={{ background: i.colorHex }}
                        />
                      )}
                      {[i.material, i.colorHex].filter(Boolean).join(" ") ||
                        t("prints:review.unknown")}
                    </span>
                  ),
                  sort: "material",
                  filter: "material",
                },
                {
                  id: "grams",
                  header: t("prints:review.columns.grams"),
                  numeric: true,
                  cell: (i) => formatWeight(i.grams),
                  sort: "grams",
                  filter: "grams",
                },
                {
                  id: "spool",
                  header: t("prints:review.columns.spool"),
                  cell: (i) => (
                    <Combobox
                      aria-label={t("prints:review.pick", {
                        title: printName(t, { number: i.printNumber, title: i.printTitle }),
                      })}
                      value={picked[i.usageId] ?? ""}
                      onChange={(v) => setPicked((p) => ({ ...p, [i.usageId]: v }))}
                      options={[
                        { value: "", label: "" },
                        ...optionsFor(i).map(({ spool, profile }) => ({
                          value: spool.id,
                          label: t("prints:form.spoolOption", {
                            name: spoolName(t, spool, profile),
                            weight: formatWeight(spool.remainingGrams),
                          }),
                        })),
                      ]}
                    />
                  ),
                },
                {
                  id: "actions",
                  header: "",
                  cell: (i) => (
                    <span className="flex items-center justify-end gap-2">
                      <Button
                        variant="primary"
                        disabled={!picked[i.usageId] || assign.isPending}
                        onClick={() =>
                          assign.mutate({ usageId: i.usageId, spoolId: picked[i.usageId] ?? "" })
                        }
                      >
                        {t("prints:review.assign")}
                      </Button>
                      <Button variant="ghost" onClick={() => setAdding(i)}>
                        {t("prints:review.addSpool")}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={dismiss.isPending}
                        onClick={() => dismiss.mutate([i.usageId])}
                      >
                        {t("prints:review.skip")}
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
          </>
        )
      )}
      <NewSpoolDialog
        open={
          adding && {
            colorHex: adding.colorHex ?? undefined,
            filament: adding.material ?? undefined,
          }
        }
        onClose={() => setAdding(null)}
        onSaved={(s) => adding && setPicked((p) => ({ ...p, [adding.usageId]: s.id }))}
      />
    </>
  );
}
