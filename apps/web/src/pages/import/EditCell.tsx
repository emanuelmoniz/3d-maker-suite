import {
  type ImportCell,
  type ImportColumn,
  type ImportErrorCode,
  parseCell,
} from "@3d-maker-suite/core";
import { RotateCcw, X } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { cx } from "../../lib/cx.ts";
import { toLocalInput } from "../../lib/format.ts";

/** A parsed value as a file cell holds it: money in major units. */
export const cellText = (c: ImportColumn, v: ImportCell | undefined) =>
  v == null ? "" : c.type === "money" && typeof v === "number" ? String(v / 100) : String(v);

const HEX = /^#[0-9a-f]{6}$/i;
const fieldClass = `${inputClass} w-auto! min-w-28`;

/**
 * A review cell: its value, a button that opens the column type's input. Enter or leaving the cell
 * keeps the edit, Escape drops it; `text` is the cell as a file holds it, `null` is empty.
 */
export function EditCell({
  col,
  label,
  row,
  text,
  edited,
  error,
  names,
  optionLabel,
  errorText,
  onCommit,
  onReset,
  children,
}: {
  col: ImportColumn;
  label: string;
  row: number;
  text: string;
  edited: boolean;
  /** The cell's error now (the file's or the edit's). */
  error?: string;
  /** `ref`: the names you have. */
  names?: string[];
  optionLabel: (option: string) => string;
  errorText: (code: ImportErrorCode) => string;
  onCommit: (text: string | null) => void;
  onReset: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const wrap = useRef<HTMLFieldSetElement>(null);
  // While editing: the input's value, and what it started as (unchanged = no edit).
  const [edit, setEdit] = useState<{ start: string; draft: string } | null>(null);
  const editing = !!edit;
  useEffect(() => {
    if (editing) wrap.current?.querySelector("input")?.focus();
  }, [editing]);

  const date = col.type === "datetime";
  // A time is typed in local time and kept as UTC, as the file's would be read.
  const out = (draft: string) =>
    date ? (draft ? new Date(draft).toISOString() : null) : draft.trim() || null;
  const open = () => {
    const start = date ? (text && !Number.isNaN(Date.parse(text)) ? toLocalInput(text) : "") : text;
    setEdit({ start, draft: start });
  };
  const done = (draft = edit?.draft) => {
    if (edit && draft !== undefined && draft !== edit.start) onCommit(out(draft));
    setEdit(null);
  };
  const set = (draft: string) => setEdit((e) => e && { ...e, draft });
  const name = { column: label, row };

  if (!edit)
    return (
      <span className={cx("inline-flex flex-col", edited && "border-l-2 border-accent pl-1.5")}>
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={open}
            className="-mx-1 min-h-6 min-w-8 rounded px-1 text-left hover:bg-surface-2"
          >
            <span className="sr-only">{t("import:review.editCell", name)} </span>
            {children}
            {edited && <span className="sr-only"> {t("import:review.edited")}</span>}
          </button>
          {edited && (
            <button
              type="button"
              aria-label={t("import:review.resetCell", name)}
              title={t("import:review.resetCell", name)}
              onClick={onReset}
              className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </span>
        {error && <span className="text-bad">{error}</span>}
      </span>
    );

  const check = parseCell(col, out(edit.draft));
  const live = "error" in check ? errorText(check.error) : undefined;
  const common = {
    "aria-label": t("import:review.cellFor", name),
    "aria-invalid": live ? true : undefined,
    value: edit.draft,
    onChange: (e: { target: { value: string } }) => set(e.target.value),
    className: fieldClass,
  };
  const input =
    col.type === "enum" ? (
      <Combobox
        aria-label={common["aria-label"]}
        className={fieldClass}
        value={edit.draft}
        onChange={(v) => done(v)}
        options={[
          ...(col.required ? [] : [{ value: "", label: t("import:review.empty") }]),
          ...(col.options ?? []).map((o) => ({ value: o, label: optionLabel(o) })),
        ]}
      />
    ) : col.type === "color" ? (
      <span className="inline-flex items-center gap-1">
        <input
          type="color"
          aria-label={common["aria-label"]}
          value={HEX.test(edit.draft) ? edit.draft : "#000000"}
          onChange={common.onChange}
          className="h-9 w-10 rounded border border-border"
        />
        <input {...common} type="text" className={`${inputClass} w-28!`} />
        {!col.required && (
          <button
            type="button"
            aria-label={t("import:review.clearCell", name)}
            onClick={() => set("")}
            className="rounded p-1 text-muted hover:bg-surface-2"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </span>
    ) : col.type === "ref" ? (
      <>
        <input {...common} type="text" list={listId} />
        <datalist id={listId}>
          {names?.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {!!edit.draft.trim() && names && !names.includes(edit.draft.trim()) && (
          <span className="text-muted">{t("import:review.newName")}</span>
        )}
      </>
    ) : (
      <input
        {...common}
        type={col.type === "date" ? "date" : date ? "datetime-local" : "text"}
        inputMode={
          col.type === "integer"
            ? "numeric"
            : col.type === "number" || col.type === "money"
              ? "decimal"
              : undefined
        }
      />
    );

  return (
    <fieldset
      ref={wrap}
      aria-label={t("import:review.cellFor", name)}
      className="inline-flex flex-col gap-1"
      onBlur={(e: FocusEvent) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) done();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        // The list of a select uses these keys first.
        if (e.defaultPrevented) return;
        if (e.key === "Enter") done();
        if (e.key === "Escape") setEdit(null);
      }}
    >
      <span className="inline-flex items-center gap-1">{input}</span>
      {live && <span className="text-bad">{live}</span>}
    </fieldset>
  );
}
