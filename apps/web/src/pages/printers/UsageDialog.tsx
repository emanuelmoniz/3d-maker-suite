import type { UsageTotals } from "@3d-maker-suite/core";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { formatDateTime, formatDuration, formatNumber } from "../../lib/format.ts";
import { useCorrectUsage, useUsage, useUsageHistory } from "../../lib/printers.ts";

const hoursOf = (sec: number) => String(Math.round((sec / 3600) * 100) / 100);
/** A signed change: "+6 h 30 min", "−12". */
const signedTime = (sec: number) => `${sec < 0 ? "−" : "+"}${formatDuration(sec)}`;
const signedCount = (n: number) => formatNumber(n, { signDisplay: "always" });

/**
 * Modal: type the totals the machine shows; the difference from what the app counted is saved as
 * a correction (shown live before saving), with every correction so far. Native <dialog> like
 * AdjustDialog. `base`: "/api/printers/<id>" or "/api/accessories/<id>".
 */
export function UsageDialog({
  base,
  name,
  open,
  onClose,
}: {
  base: string;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const usage = useUsage(base);
  const history = useUsageHistory(base, open);
  useEffect(() => {
    const d = ref.current;
    if (!d || open === d.open) return;
    if (open) d.showModal();
    else d.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="usage-title"
      className="m-auto w-[min(92vw,30rem)] rounded-lg border border-border bg-surface p-5 text-fg"
    >
      {open && (
        <div className="grid gap-5">
          <div>
            <h2 id="usage-title" className="text-base font-semibold">
              {t("printers:usage.title")}
            </h2>
            <p className="mt-1 text-muted">{t("printers:usage.intro", { name })}</p>
          </div>
          {usage.data ? (
            // A new key per total: the fields start from what is counted now.
            <UsageForm
              key={`${usage.data.runtimeSec}-${usage.data.prints}`}
              base={base}
              now={usage.data}
              onClose={onClose}
            />
          ) : usage.isError ? (
            <p role="alert" className="text-bad">
              {t("printers:usage.loadError")}
            </p>
          ) : null}
          <section aria-labelledby="usage-history" className="border-t border-border pt-4">
            <h3 id="usage-history" className="mb-2 font-medium">
              {t("printers:usage.historyTitle")}
            </h3>
            {history.data && !history.data.length && (
              <p className="text-muted">{t("printers:usage.historyEmpty")}</p>
            )}
            <ul className="grid max-h-56 gap-2 overflow-y-auto">
              {history.data?.map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-x-3">
                  <span className="min-w-0 wrap-anywhere">
                    {c.note ?? <span className="text-muted">{t("printers:usage.noNote")}</span>}
                    <span className="block text-xs text-muted">{formatDateTime(c.createdAt)}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    {signedTime(c.deltaSec)}
                    <span className="block text-xs text-muted">
                      {t("printers:usage.deltaPrints", {
                        count: Math.abs(c.deltaPrints),
                        value: signedCount(c.deltaPrints),
                      })}
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

/** Counted next to corrected, the change between them live under each field. */
function UsageForm({
  base,
  now,
  onClose,
}: {
  base: string;
  now: UsageTotals;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const correct = useCorrectUsage(base);
  const [hours, setHours] = useState(hoursOf(now.runtimeSec));
  const [prints, setPrints] = useState(String(now.prints));
  const ids = { hours: useId(), prints: useId() };
  // Untouched hours keep the exact seconds: the field shows them rounded.
  const runtimeSec =
    hours === hoursOf(now.runtimeSec) ? now.runtimeSec : Math.round(Number(hours) * 3600);
  const dSec = hours === "" ? 0 : runtimeSec - now.runtimeSec;
  const dPrints = prints === "" ? 0 : Number(prints) - now.prints;

  const row = "grid grid-cols-[1fr_8rem] items-start gap-x-4 gap-y-1";
  const change = (text: string | null, id: string) => (
    <p id={id} aria-live="polite" className="col-start-2 min-h-5 text-sm tabular-nums text-accent">
      {text}
    </p>
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
        correct.mutate(
          { runtimeSec, prints: Number(prints), note: note || null },
          { onSuccess: onClose },
        );
      }}
    >
      <div className={`${row} text-sm text-muted`}>
        <span>{t("printers:usage.counted")}</span>
        <span>{t("printers:usage.corrected")}</span>
      </div>
      <div className={row}>
        <div>
          <label htmlFor={ids.hours} className="font-medium">
            {t("printers:usage.hours")}
          </label>
          <p className="text-lg tabular-nums">{formatDuration(now.runtimeSec)}</p>
        </div>
        <input
          id={ids.hours}
          name="hours"
          type="number"
          required
          min={0}
          step={0.01}
          inputMode="decimal"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          aria-describedby={`${ids.hours}-change`}
          className={`${inputClass} text-right tabular-nums`}
        />
        {change(dSec ? signedTime(dSec) : null, `${ids.hours}-change`)}
      </div>
      <div className={row}>
        <div>
          <label htmlFor={ids.prints} className="font-medium">
            {t("printers:usage.prints")}
          </label>
          <p className="text-lg tabular-nums">{formatNumber(now.prints)}</p>
        </div>
        <input
          id={ids.prints}
          name="prints"
          type="number"
          required
          min={0}
          step={1}
          inputMode="numeric"
          value={prints}
          onChange={(e) => setPrints(e.target.value)}
          aria-describedby={`${ids.prints}-change`}
          className={`${inputClass} text-right tabular-nums`}
        />
        {change(dPrints ? signedCount(dPrints) : null, `${ids.prints}-change`)}
      </div>
      <FormField label={t("printers:usage.note")} hint={t("printers:usage.noteHint")}>
        {(p) => <input {...p} name="note" maxLength={200} className={inputClass} />}
      </FormField>
      {correct.isError && (
        <p role="alert" className="text-bad">
          {t("printers:usage.saveError")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={correct.isPending || (!dSec && !dPrints)}>
          {t("printers:usage.save")}
        </Button>
      </div>
    </form>
  );
}
