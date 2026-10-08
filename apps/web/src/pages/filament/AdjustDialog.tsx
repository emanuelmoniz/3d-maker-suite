import type { Spool } from "@3d-maker-suite/core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { useAdjustSpool, useSpoolHistory } from "../../lib/filament.ts";
import { formatDateTime, formatNumber, formatWeight } from "../../lib/format.ts";

const ENTRY = {
  manual: "filament:adjust.entryKinds.manual",
  print: "filament:adjust.entryKinds.print",
  correction: "filament:adjust.entryKinds.correction",
} as const;
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Modal: set the remaining weight, and see every change so far. Native <dialog> like ConfirmDialog. */
export function AdjustDialog({
  spool,
  title,
  onClose,
}: {
  spool: Spool | null;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const adjust = useAdjustSpool();
  const history = useSpoolHistory(spool?.id);
  useEffect(() => {
    const d = ref.current;
    if (!d || !!spool === d.open) return;
    if (spool) d.showModal();
    else d.close();
  }, [spool]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!spool) return;
    const f = new FormData(e.currentTarget);
    adjust.mutate(
      {
        id: spool.id,
        kind: text(f, "kind") === "correction" ? "correction" : "manual",
        remainingGrams: Number(text(f, "remaining")),
        note: text(f, "note") || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,28rem)] rounded-lg border border-border bg-surface p-5 text-fg"
    >
      {spool && (
        <div className="grid gap-4">
          <form key={spool.id} onSubmit={onSubmit} className="grid gap-4">
            <div>
              <h2 className="text-base font-semibold">{t("filament:adjust.title")}</h2>
              <p className="mt-1 text-muted">
                {t("filament:adjust.summary", {
                  filament: title,
                  weight: formatWeight(spool.remainingGrams),
                })}
              </p>
            </div>
            <FormField label={t("filament:adjust.kind")}>
              {(p) => (
                <select {...p} name="kind" className={inputClass}>
                  <option value="manual">{t("filament:adjust.kinds.manual")}</option>
                  <option value="correction">{t("filament:adjust.kinds.correction")}</option>
                </select>
              )}
            </FormField>
            <FormField label={t("filament:adjust.remaining")}>
              {(p) => (
                <input
                  {...p}
                  name="remaining"
                  type="number"
                  required
                  min={0}
                  step={0.1}
                  defaultValue={spool.remainingGrams}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField label={t("filament:adjust.note")}>
              {(p) => <input {...p} name="note" className={inputClass} />}
            </FormField>
            {adjust.isError && (
              <p role="alert" className="text-bad">
                {t("filament:adjust.error")}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
              <Button type="submit" variant="primary" disabled={adjust.isPending}>
                {t("filament:adjust.save")}
              </Button>
            </div>
          </form>
          <section>
            <h3 className="mb-2 font-medium">{t("filament:adjust.historyTitle")}</h3>
            {history.data && !history.data.length && (
              <p className="text-muted">{t("filament:adjust.historyEmpty")}</p>
            )}
            <ul className="grid max-h-56 gap-1 overflow-y-auto">
              {history.data?.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {t(ENTRY[e.kind])}
                    {e.note && <span className="text-muted"> · {e.note}</span>}
                    <span className="block text-xs text-muted">{formatDateTime(e.createdAt)}</span>
                  </span>
                  <span className="tabular-nums">
                    {e.deltaGrams > 0 ? "+" : ""}
                    {formatNumber(e.deltaGrams, { maximumFractionDigits: 1 })} g
                    <span className="block text-xs text-muted">
                      {formatWeight(e.remainingAfter)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </dialog>
  );
}
