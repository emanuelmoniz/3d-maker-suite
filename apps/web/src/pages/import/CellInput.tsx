import type { ImportColumn } from "@3d-maker-suite/core";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { DateTimeInput } from "../../components/DateTimeInput.tsx";
import { inputClass } from "../../components/FormField.tsx";

const HEX = /^#[0-9a-f]{6}$/i;

/** What an input's draft says as a file cell: a time is typed in local time and kept as UTC. */
export const cellOut = (col: ImportColumn, draft: string) =>
  col.type === "datetime" ? (draft ? new Date(draft).toISOString() : null) : draft.trim() || null;

/**
 * The column type's input, as the review table and the bulk form use it. `required`: it must hold
 * a value, so a list offers no Empty and the browser checks it.
 */
export function CellInput({
  col,
  label,
  clearLabel,
  value,
  invalid,
  required,
  describedBy,
  names,
  optionLabel,
  onChange,
  onPick = onChange,
  className = inputClass,
}: {
  col: ImportColumn;
  label: string;
  /** Offers a clear button on a colour that may be empty. */
  clearLabel?: string;
  /** The draft: for a `datetime`, local time as the input holds it. */
  value: string;
  invalid?: boolean;
  required?: boolean;
  describedBy?: string;
  /** `ref`: the names you have. */
  names?: string[];
  optionLabel: (option: string) => string;
  onChange: (draft: string) => void;
  /** A value picked from a list; default `onChange`. */
  onPick?: (draft: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const aria = {
    "aria-label": label,
    "aria-invalid": invalid ? true : undefined,
    "aria-describedby": describedBy,
  };
  const empty = col.required || required ? [] : [{ value: "", label: t("import:review.empty") }];
  const placeholder = required ? t("import:review.pickTarget") : undefined;
  if (col.type === "enum")
    return (
      <Combobox
        {...aria}
        required={required}
        placeholder={placeholder}
        className={className}
        value={value}
        onChange={onPick}
        options={[
          ...empty,
          ...(col.options ?? []).map((o) => ({ value: o, label: optionLabel(o) })),
        ]}
      />
    );
  if (col.type === "color") {
    const text = {
      ...aria,
      required,
      value,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    };
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="color"
          aria-label={label}
          value={HEX.test(value) ? value : "#000000"}
          onChange={text.onChange}
          className="h-9 w-10 rounded border border-border"
        />
        <input {...text} type="text" className={`${inputClass} w-28!`} />
        {!col.required && clearLabel && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => onChange("")}
            className="rounded p-1 text-muted hover:bg-surface-2"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </span>
    );
  }
  if (col.type === "ref")
    // The app's own list (a native datalist is drawn by the browser, away from the cell); a name
    // you type that isn't there is a new one.
    return (
      <>
        <Combobox
          free
          {...aria}
          required={required}
          placeholder={placeholder}
          className={className}
          value={value}
          onChange={onPick}
          options={[...empty, ...(names ?? []).map((n) => ({ value: n, label: n }))]}
        />
        {!!value.trim() && names && !names.includes(value.trim()) && (
          <span className="text-muted">{t("import:review.newName")}</span>
        )}
      </>
    );
  if (col.type === "date")
    return (
      <DateInput
        {...aria}
        required={required}
        value={value}
        onChange={onChange}
        className={className}
      />
    );
  if (col.type === "datetime")
    return <DateTimeInput {...aria} required={required} value={value} onChange={onChange} />;
  return (
    <input
      {...aria}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      type="text"
      inputMode={
        col.type === "integer"
          ? "numeric"
          : col.type === "number" || col.type === "money"
            ? "decimal"
            : undefined
      }
    />
  );
}
