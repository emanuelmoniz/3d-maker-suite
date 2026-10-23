import { Calendar } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateFormatHint, formatDate, parseDateText } from "../lib/format.ts";
import { inputClass } from "./FormField.tsx";

const toText = (iso: string) => (iso ? formatDate(`${iso}T12:00:00Z`) : "");

type Props = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  /** ISO "yyyy-mm-dd" or "". */
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
};

/**
 * A date field typed in the format chosen in Settings (a native date input follows the browser
 * instead). Works controlled or not; with `name` the form gets the ISO day, "" if the text is
 * not a valid day in `min`..`max`.
 */
export function DateInput({
  value,
  defaultValue,
  onChange,
  name,
  min,
  max,
  className,
  ...rest
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(toText(value ?? defaultValue ?? ""));
  const parsed = text.trim() ? parseDateText(text) : "";
  const iso = parsed !== null && (!min || parsed >= min) && (!max || parsed <= max) ? parsed : "";
  const bad = !!text.trim() && !iso;

  // A controlled parent that changes the value (clear, reset) wins over what was typed.
  useEffect(() => {
    if (value !== undefined && value !== iso) setText(toText(value));
  }, [value]);
  useEffect(() => {
    ref.current?.setCustomValidity(
      bad ? t("common:dateInput.invalid", { format: dateFormatHint() }) : "",
    );
  }, [bad, t]);

  const picker = useRef<HTMLInputElement>(null);
  const inRange = (p: string | null) =>
    p !== null && (!min || p >= min) && (!max || p <= max) ? p : "";

  return (
    <div className="relative min-w-0 flex-1">
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={dateFormatHint()}
        className={`${className ?? inputClass} pr-9`}
        aria-invalid={bad || rest["aria-invalid"] ? true : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange?.(inRange(e.target.value.trim() ? parseDateText(e.target.value) : ""));
        }}
      />
      <button
        type="button"
        aria-label={t("common:dateInput.openPicker")}
        disabled={rest.disabled}
        onClick={() => picker.current?.showPicker()}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted hover:text-text"
      >
        <Calendar aria-hidden="true" className="size-4" />
      </button>
      {/* The browser's calendar, only as a picker: the text field above stays the value. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        min={min}
        max={max}
        value={iso}
        onChange={(e) => {
          setText(toText(e.target.value));
          onChange?.(e.target.value);
        }}
        className="pointer-events-none absolute right-0 bottom-0 size-px opacity-0"
      />
      {name && <input type="hidden" name={name} value={iso} />}
    </div>
  );
}
