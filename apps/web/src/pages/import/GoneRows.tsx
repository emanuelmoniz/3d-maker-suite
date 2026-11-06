import type { ImportGone, ImportPreview, ImportResult, ReviewedType } from "@3d-maker-suite/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dependents } from "../../components/ArchiveActions.tsx";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { api } from "../../lib/api.ts";

/**
 * Catalog rows whose preset is gone from the slicer (ADR-0019). Nothing goes without a person: a
 * free one offers Delete (Archive when you edited it), one in use says what uses it. With no other
 * rows to review, Keep the rest closes the review.
 */
export function GoneRows({
  id,
  type,
  preview,
  onKept,
}: {
  id: string;
  type: ReviewedType;
  preview: ImportPreview & { gone: ImportGone[] };
  /** Shown when the review has no other rows: closes it without changing anything. */
  onKept?: (r: ImportResult) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ask, setAsk] = useState<ImportGone | null>(null);
  // The review is read again: what is left comes back fresh.
  const refresh = () => qc.invalidateQueries({ queryKey: ["import-source"] });
  const remove = useMutation({
    mutationFn: (g: ImportGone) =>
      api("DELETE", `/api/import/integration/${id}/${type}/gone/${g.id}`),
    onSuccess: () => {
      setAsk(null);
      void refresh();
    },
  });
  const keep = useMutation({
    mutationFn: () =>
      api<ImportResult>("POST", `/api/import/${preview.entity}/apply`, {
        uploadId: preview.uploadId,
        policy: "keepEdits",
        decisions: [],
      }),
    onSuccess: (r) => onKept?.(r),
  });

  const heading = useId();

  return (
    <section
      aria-labelledby={heading}
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <div className="grid gap-1">
        <h2 id={heading} className="font-semibold">
          {t("import:gone.title")}
        </h2>
        <p className="text-muted">{t("import:gone.body")}</p>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {preview.gone.map((g) => (
          <li key={g.id} className="grid gap-2 p-3 sm:flex sm:items-start sm:justify-between">
            <div className="grid gap-1">
              <span className="font-medium wrap-anywhere">{g.label}</span>
              {g.dependents.length > 0 && (
                <>
                  <span className="text-muted">{t("import:gone.inUse")}</span>
                  <Dependents details={{ dependents: g.dependents }} />
                </>
              )}
            </div>
            {g.dependents.length === 0 && (
              <Button
                aria-label={t("common:archive.named.delete", { name: g.label })}
                onClick={() => {
                  remove.reset();
                  setAsk(g);
                }}
              >
                {t("common:archive.actions.delete")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {onKept && !keep.isSuccess && (
        <div className="grid gap-2 sm:flex sm:items-center">
          <Button onClick={() => keep.mutate()} disabled={keep.isPending}>
            {t("import:gone.keep")}
          </Button>
          <span className="text-muted">{t("import:gone.keepHint")}</span>
          {keep.isError && (
            <p role="alert" className="text-bad">
              {t("common:archive.errors.generic")}
            </p>
          )}
        </div>
      )}
      {ask && (
        <ConfirmDialog
          open
          destructive
          title={t("common:archive.deleteTitle", { name: ask.label })}
          description={t("common:archive.deleteBody")}
          confirmLabel={t("common:archive.actions.delete")}
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            if (!remove.isPending) remove.mutate(ask);
          }}
        >
          {remove.isError && (
            <p role="alert" className="text-bad">
              {t("common:archive.errors.generic")}
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
