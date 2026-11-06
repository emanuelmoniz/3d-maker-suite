import {
  type BulkResult,
  type FilamentReviewItem,
  filamentReviewFilters,
  usableOn,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BulkRow } from "../../components/ArchiveActions.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SelectionBar, SelectionResult } from "../../components/SelectionBar.tsx";
import { useCan } from "../../lib/auth.ts";
import { spoolName, useSpools } from "../../lib/filament.ts";
import { formatDateTime, formatWeight } from "../../lib/format.ts";
import { useUrlListQuery } from "../../lib/list.ts";
import {
  printName,
  useAssignReview,
  useBulkAssignReview,
  useDismissReview,
  useFilamentReview,
} from "../../lib/prints.ts";
import { NewSpoolDialog } from "../filament/NewSpoolDialog.tsx";

/**
 * The bar over ticked rows: one spool for all of them, or none tracked. Assign runs at once and
 * lists the rows it couldn't do, which stay selected; Don't track can't be undone, so it asks.
 */
function ReviewBar({
  rows,
  clear,
  done,
  spools,
}: {
  rows: BulkRow[];
  clear: () => void;
  done: (blocked: string[]) => void;
  spools: { value: string; label: string }[];
}) {
  const { t } = useTranslation();
  const assign = useBulkAssignReview();
  const dismiss = useDismissReview();
  const [ask, setAsk] = useState<"assign" | "dismiss" | null>(null);
  const [spoolId, setSpoolId] = useState("");
  const [outcome, setOutcome] = useState<{
    total: number;
    names: Map<string, string>;
    result: BulkResult;
  } | null>(null);

  const runAssign = () =>
    assign.mutate(
      { usageIds: rows.map((r) => r.id), spoolId },
      {
        onSuccess: (result) => {
          setAsk(null);
          setOutcome(
            result.blocked.length
              ? { total: rows.length, names: new Map(rows.map((r) => [r.id, r.name])), result }
              : null,
          );
          done(result.blocked.map((b) => b.id));
        },
      },
    );
  const runDismiss = () =>
    dismiss.mutate(
      rows.map((r) => r.id),
      {
        onSuccess: () => {
          setAsk(null);
          setOutcome(null);
          done([]);
        },
      },
    );

  return (
    <>
      <SelectionBar count={rows.length} onClear={clear}>
        <Button
          onClick={() => {
            assign.reset();
            setAsk("assign");
          }}
        >
          {t("prints:review.bulk.assign")}
        </Button>
        <Button
          onClick={() => {
            dismiss.reset();
            setAsk("dismiss");
          }}
        >
          {t("prints:review.bulk.dismiss")}
        </Button>
      </SelectionBar>
      <SelectionResult open={!!outcome} onDismiss={() => setOutcome(null)}>
        {outcome && (
          <>
            <p className="font-medium">
              {t("prints:review.bulk.assigned", {
                done: outcome.result.done.length,
                total: outcome.total,
              })}
            </p>
            <p className="text-muted">{t("prints:review.bulk.blocked")}</p>
            <ul className="grid max-h-60 gap-1 overflow-y-auto">
              {outcome.result.blocked.map((b) => (
                <li key={b.id} className="grid gap-0.5">
                  <span className="font-medium wrap-anywhere">{outcome.names.get(b.id)}</span>
                  <span className="text-bad">{b.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </SelectionResult>
      <FormDialog
        open={ask === "assign"}
        title={t("prints:review.bulk.assignTitle", { count: rows.length })}
        submitLabel={assign.isPending ? t("common:bulk.working") : t("prints:review.assign")}
        busy={assign.isPending}
        error={assign.isError ? t("prints:review.assignError") : undefined}
        onSubmit={() => spoolId && !assign.isPending && runAssign()}
        onCancel={() => setAsk(null)}
      >
        <FormField label={t("prints:review.columns.spool")} hint={t("prints:review.bulk.hint")}>
          {(p) => (
            <Combobox
              {...p}
              required
              value={spoolId}
              onChange={setSpoolId}
              options={[{ value: "", label: "" }, ...spools]}
            />
          )}
        </FormField>
      </FormDialog>
      {ask === "dismiss" && (
        <ConfirmDialog
          open
          destructive
          title={t("prints:review.bulk.dismissTitle", { count: rows.length })}
          description={t("prints:review.bulk.dismissBody")}
          confirmLabel={dismiss.isPending ? t("common:bulk.working") : t("prints:review.skip")}
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            if (!dismiss.isPending) runDismiss();
          }}
        >
          {dismiss.isError && (
            <p role="alert" className="text-bad">
              {t("prints:review.error")}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

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
  const assign = useAssignReview();
  const dismiss = useDismissReview();
  const mayAssign = useCan("prints"); // the routes' "prints write"
  const [picked, setPicked] = useState<Record<string, string>>({});
  // The slot a new spool is being added for.
  const [adding, setAdding] = useState<FilamentReviewItem | null>(null);
  // Spools opened by the print's day; the reported material and colour first, then the material.
  const optionsFor = (i: FilamentReviewItem) =>
    spools
      .filter((s) => usableOn(s, i.startedAt))
      .map((s) => {
        const material = !!i.material && s.material.toLowerCase() === i.material.toLowerCase();
        const color = !!i.colorHex && s.colorHex.toLowerCase() === i.colorHex.toLowerCase();
        return { spool: s, rank: Number(material) * (color ? 2 : 1) };
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
          <DataTable
            label={t("prints:review.table")}
            rows={items}
            rowKey={(i) => i.usageId}
            select={{
              path: "/api/prints/filament-review",
              can: mayAssign,
              name: (i) => printName(t, { number: i.printNumber, title: i.printTitle }),
              bar: (s) => (
                <ReviewBar
                  {...s}
                  spools={spools.map((sp) => ({
                    value: sp.id,
                    label: t("prints:form.spoolOption", {
                      name: spoolName(t, sp),
                      weight: formatWeight(sp.remainingGrams),
                    }),
                  }))}
                />
              ),
            }}
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
                archivedMark: true,
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
                      ...optionsFor(i).map(({ spool }) => ({
                        value: spool.id,
                        label: t("prints:form.spoolOption", {
                          name: spoolName(t, spool),
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
                    <Button onClick={() => setAdding(i)}>
                      <Plus className="size-4" aria-hidden />
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
