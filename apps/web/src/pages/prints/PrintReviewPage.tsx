import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { filamentLabel, useProfiles, useSpools } from "../../lib/filament.ts";
import { formatDateTime, formatWeight } from "../../lib/format.ts";
import { useAssignReview, useDismissReview, useFilamentReview } from "../../lib/prints.ts";

/** Imported filament that couldn't be matched to exactly one spool: a person decides. */
export function PrintReviewPage() {
  const { t } = useTranslation();
  const { data: items, isError } = useFilamentReview();
  const spools = (useSpools().data?.items ?? []).filter(
    (s) => !s.archivedAt && s.status !== "empty",
  );
  const profiles = useProfiles().data?.items ?? [];
  const assign = useAssignReview();
  const dismiss = useDismissReview();
  const [picked, setPicked] = useState<Record<string, string>>({});
  // Spools of the reported material first.
  const optionsFor = (material: string | null) =>
    spools
      .map((s) => {
        const profile = profiles.find((p) => p.id === s.profileId);
        const same = !!material && profile?.material.toLowerCase() === material.toLowerCase();
        return { spool: s, profile, same };
      })
      .sort((a, b) => Number(b.same) - Number(a.same));

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
      {items && !items.length ? (
        <EmptyState
          icon={CheckCircle2}
          title={t("prints:review.emptyTitle")}
          description={t("prints:review.emptyBody")}
        />
      ) : (
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
              columns={[
                {
                  id: "print",
                  header: t("prints:review.columns.print"),
                  cell: (i) => (
                    <>
                      <span className="font-medium">{i.printTitle}</span>
                      <span className="block text-muted">{formatDateTime(i.startedAt)}</span>
                    </>
                  ),
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
                },
                {
                  id: "grams",
                  header: t("prints:review.columns.grams"),
                  numeric: true,
                  cell: (i) => formatWeight(i.grams),
                  sortValue: (i) => i.grams,
                },
                {
                  id: "spool",
                  header: t("prints:review.columns.spool"),
                  cell: (i) => (
                    <select
                      aria-label={t("prints:review.pick", { title: i.printTitle })}
                      className={inputClass}
                      value={picked[i.usageId] ?? ""}
                      onChange={(e) => setPicked((p) => ({ ...p, [i.usageId]: e.target.value }))}
                    >
                      <option value="" />
                      {optionsFor(i.material).map(({ spool, profile }) => (
                        <option key={spool.id} value={spool.id}>
                          {t("prints:form.spoolOption", {
                            filament: filamentLabel(profile),
                            color: spool.colorHex,
                            weight: formatWeight(spool.remainingGrams),
                          })}
                        </option>
                      ))}
                    </select>
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
    </>
  );
}
