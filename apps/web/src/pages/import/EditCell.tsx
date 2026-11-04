import {
  type ImportCell,
  type ImportColumn,
  type ImportErrorCode,
  parseCell,
} from "@3d-maker-suite/core";
import { RotateCcw } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { inputClass } from "../../components/FormField.tsx";
import { cx } from "../../lib/cx.ts";
import { toLocalInput } from "../../lib/format.ts";
import { CellInput, cellOut } from "./CellInput.tsx";

/** A parsed value as a file cell holds it: money in major units. */
export const cellText = (c: ImportColumn, v: ImportCell | undefined) =>
  v == null ? "" : c.type === "money" && typeof v === "number" ? String(v / 100) : String(v);

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
  const wrap = useRef<HTMLFieldSetElement>(null);
  // While editing: the input's value, and what it started as (unchanged = no edit).
  const [edit, setEdit] = useState<{ start: string; draft: string } | null>(null);
  const editing = !!edit;
  useEffect(() => {
    if (editing) wrap.current?.querySelector("input")?.focus();
  }, [editing]);

  const open = () => {
    const start =
      col.type === "datetime"
        ? text && !Number.isNaN(Date.parse(text))
          ? toLocalInput(text)
          : ""
        : text;
    setEdit({ start, draft: start });
  };
  const done = (draft = edit?.draft) => {
    if (edit && draft !== undefined && draft !== edit.start) onCommit(cellOut(col, draft));
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

  const check = parseCell(col, cellOut(col, edit.draft));
  const live = "error" in check ? errorText(check.error) : undefined;

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
      <span className="inline-flex items-center gap-1">
        <CellInput
          col={col}
          label={t("import:review.cellFor", name)}
          clearLabel={t("import:review.clearCell", name)}
          value={edit.draft}
          invalid={!!live}
          names={names}
          optionLabel={optionLabel}
          onChange={set}
          onPick={(v) => done(v)}
          className={fieldClass}
        />
      </span>
      {live && <span className="text-bad">{live}</span>}
    </fieldset>
  );
}
