import { Clock } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n.ts";
import { cx } from "../lib/cx.ts";
import { formatTime, from12h, to12h, uses12h } from "../lib/format.ts";
import { placePopover } from "../lib/placePopover.ts";
import { Button } from "./Button.tsx";
import { inputClass } from "./FormField.tsx";

export type Time = { hour: number; minute: number };

const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const pad = (n: number) => String(n).padStart(2, "0");
/** The locale's AM / PM. */
const period = (pm: boolean) =>
  new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: "numeric", hourCycle: "h12" })
    .formatToParts(new Date(2000, 0, 1, pm ? 13 : 1))
    .find((p) => p.type === "dayPeriod")?.value ?? (pm ? "PM" : "AM");

const cell = (on: boolean) =>
  cx(
    "h-9 rounded-md tabular-nums transition-colors",
    on ? "bg-accent font-medium text-accent-fg" : "hover:bg-surface-2",
  );

/**
 * A time of day in the 12/24-hour format chosen in Settings (a native time input follows the
 * browser instead). Picks in the panel are a draft: Done saves them once, Escape or a click outside
 * drops them. `minutes={false}` picks a whole hour.
 */
export function TimeInput({
  value,
  onChange,
  emptyLabel,
  clearLabel = emptyLabel,
  minutes = true,
  hours: withHours = true,
  minuteOptions = MINUTES,
  disabled,
  ...aria
}: {
  value: Time | null;
  onChange: (value: Time | null) => void;
  /** What the field shows when no time is set. */
  emptyLabel: string;
  /** The panel's button that unsets the time. */
  clearLabel?: string;
  minutes?: boolean;
  /** `false` picks only a minute (shown as ":07"); the hour stays 0. */
  hours?: boolean;
  minuteOptions?: number[];
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Time>(value ?? { hour: 0, minute: 0 });
  const twelve = uses12h();
  const { hour: h12, pm } = to12h(draft.hour);

  const show = () => {
    setDraft(value ?? { hour: 0, minute: 0 });
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const save = (v: Time | null) => {
    onChange(v);
    close();
  };

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !trigger.current) return;
    if (open !== el.matches(":popover-open")) el.togglePopover(open);
    if (!open) return;
    placePopover(trigger.current, el);
  });
  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLButtonElement>(
        "[data-hour][aria-pressed=true], [data-minute][aria-pressed=true]",
      )
      ?.focus();
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const place = () =>
      panel.current && trigger.current && placePopover(trigger.current, panel.current);
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const hours = twelve
    ? [12, ...Array.from({ length: 11 }, (_, i) => i + 1)]
    : [...Array(24).keys()];
  const hourOn = (h: number) => (twelve ? h === h12 : h === draft.hour);
  const setHour = (h: number) => setDraft((d) => ({ ...d, hour: twelve ? from12h(h, pm) : h }));

  return (
    <>
      <button
        {...aria}
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        className={cx(inputClass, "flex items-center justify-between gap-2 text-left")}
      >
        <span className={cx("tabular-nums", !value && "text-muted")}>
          {!value
            ? emptyLabel
            : withHours
              ? formatTime(new Date(2000, 0, 1, value.hour, value.minute))
              : `:${pad(value.minute)}`}
        </span>
        <Clock aria-hidden className="size-4 shrink-0 text-muted" />
      </button>
      <div
        ref={panel}
        id={panelId}
        popover="manual"
        role="dialog"
        aria-label={aria["aria-label"]}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
        // No `display` here: it would override the hidden state of a closed popover.
        className="fixed inset-auto m-0 w-72 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-surface text-fg shadow-lg"
      >
        <div className="grid gap-3 p-3">
          {withHours && (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 font-medium">{t("common:timeInput.hour")}</legend>
              {twelve && (
                // biome-ignore lint/a11y/useSemanticElements: two toggle buttons, not a form group
                <div
                  role="group"
                  aria-label={t("common:timeInput.period")}
                  className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-0.5"
                >
                  {[false, true].map((p) => (
                    <button
                      key={String(p)}
                      type="button"
                      aria-pressed={p === pm}
                      onClick={() => setDraft((d) => ({ ...d, hour: from12h(h12, p) }))}
                      className={cx(
                        "h-8 rounded",
                        p === pm ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-fg",
                      )}
                    >
                      {period(p)}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-6 gap-1">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    data-hour
                    aria-pressed={hourOn(h)}
                    onClick={() => setHour(h)}
                    className={cell(hourOn(h))}
                  >
                    {twelve ? h : pad(h)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {minutes && (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 font-medium">{t("common:timeInput.minute")}</legend>
              <div className="grid grid-cols-6 gap-1">
                {minuteOptions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-minute
                    aria-pressed={m === draft.minute}
                    onClick={() => setDraft((d) => ({ ...d, minute: m }))}
                    className={cell(m === draft.minute)}
                  >
                    {pad(m)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <Button variant="ghost" className="text-muted" onClick={() => save(null)}>
              {clearLabel}
            </Button>
            <Button
              variant="primary"
              onClick={() => save(minutes ? draft : { ...draft, minute: 0 })}
            >
              {t("common:timeInput.done")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
