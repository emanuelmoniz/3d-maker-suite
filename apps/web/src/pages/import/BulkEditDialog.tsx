import {
  type BulkField,
  type BulkForm,
  type BulkOption,
  bulkField,
  type ImportColumn,
  type ImportDecision,
  type ImportErrorCode,
  type ImportPreview,
  NO_PROJECT,
  parseCell,
  type Root,
  slotOf,
} from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { cx } from "../../lib/cx.ts";
import { CellInput, cellOut } from "./CellInput.tsx";

type Choice = BulkOption | "keep";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const ACTIONS: Record<BulkForm["action"], string> = {
  keep: "import:edit.keep",
  create: "import:actions.create",
  update: "import:actions.update",
  skip: "import:actions.skip",
  suggestion: "import:edit.suggestion",
};
const FOLDERS = {
  keep: "import:edit.keep",
  import: "import:edit.import",
  moveToRoot: "import:edit.moveToRoot",
  create: "import:projects.create",
  none: "import:projects.none",
} as const;
const CHOICES: Record<Choice, string> = {
  keep: "import:edit.keep",
  import: "import:edit.import",
  overwrite: "import:edit.overwrite",
  keepEdits: "import:edit.keepEdits",
  value: "import:edit.value",
  empty: "import:review.empty",
};

/** Until you change it a field is muted; one you changed stands out. */
const fieldClass = (changed: boolean, disabled = false) =>
  cx(
    inputClass,
    changed ? "border-accent ring-1 ring-accent" : "text-muted",
    disabled && "opacity-50",
  );

/** What's wrong with a typed value: "required" also covers one of only spaces. */
const valueError = (col: ImportColumn, text: string): ImportErrorCode | undefined => {
  const out = cellOut(col, text);
  if (!out) return "required";
  const parsed = parseCell(col, out);
  return "error" in parsed ? parsed.error : undefined;
};

/**
 * The form behind the selection bar: Action, Update which and the table's columns, each on Don't
 * change until you change it. `bulkField` says what a column offers given the other fields. It
 * blocks Import while open, and Apply writes to the selected rows at once (`bulkEdit`).
 */
export function BulkEditDialog({
  open,
  preview,
  columns,
  selected,
  added,
  roots,
  optionLabel,
  errorText,
  onApply,
  onCancel,
}: {
  open: boolean;
  preview: ImportPreview;
  /** The columns the table shows. */
  columns: readonly ImportColumn[];
  /** The selected rows' decisions now. */
  selected: readonly ImportDecision[];
  /** Spools added in this review. */
  added: NonNullable<ImportPreview["refOptions"]>[string];
  /** Projects only: the roots a folder can go to. Without it there is no Folder field. */
  roots?: readonly Root[];
  optionLabel: (option: string) => string;
  errorText: (code: ImportErrorCode) => string;
  onApply: (form: BulkForm) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<BulkForm>({ action: "keep", fields: {} });
  const [folderKind, setFolderKind] = useState<keyof typeof FOLDERS>("keep");
  const [folderRoot, setFolderRoot] = useState(roots?.[0]?.id ?? "");
  const [folderName, setFolderName] = useState("");
  const stateOf = (col: ImportColumn) => bulkField(col, { form, selected, preview });
  const updating =
    form.action === "update" ||
    (form.action === "keep" && selected.some((d) => d.action === "update"));
  const typed = (col: ImportColumn) => {
    const state = stateOf(col);
    const field = form.fields[col.key];
    return Array.isArray(state) &&
      state.includes("value") &&
      field?.kind === "value" &&
      field.id === undefined
      ? field.text
      : undefined;
  };
  const setField = (key: string, field: BulkField | undefined) =>
    setForm((f) => {
      const { [key]: _, ...fields } = f.fields;
      return { ...f, fields: field ? { ...fields, [key]: field } : fields };
    });
  const choose = (key: string, choice: Choice) =>
    setField(
      key,
      choice === "keep"
        ? undefined
        : choice === "value"
          ? { kind: choice, text: "" }
          : { kind: choice },
    );

  const submit = () => {
    const values = columns.flatMap((col) => {
      const text = typed(col);
      return text === undefined ? [] : [{ col, text }];
    });
    if (values.some(({ col, text }) => valueError(col, text))) return;
    const root = roots?.find((r) => r.id === folderRoot) ?? roots?.[0];
    // Skip and Use suggestion take no values, so no folder either (`bulkEdit` ignores it).
    const folder: BulkForm["folder"] =
      folderKind === "keep"
        ? undefined
        : folderKind === "moveToRoot"
          ? root && { kind: "moveToRoot", root: root.path }
          : folderKind === "create"
            ? { kind: "create", name: folderName.trim() || undefined, rootId: root?.id }
            : { kind: folderKind };
    onApply({
      ...form,
      folder,
      target: updating ? form.target : undefined,
      fields: {
        ...form.fields,
        ...Object.fromEntries(
          values.map(({ col, text }) => [
            col.key,
            { kind: "value" as const, text: cellOut(col, text) ?? "" },
          ]),
        ),
      },
    });
  };

  const readOnlyText = (col: ImportColumn) => {
    const by = col.setBy && columns.find((c) => c.key === col.setBy?.column);
    if (by) return t("import:edit.setBy", { column: t(by.label, by.labelArgs) });
    return t(col.scanned ? "import:edit.fromFolder" : "import:edit.numberLocked");
  };

  return (
    <FormDialog
      open={open}
      title={t("import:edit.title", { count: selected.length })}
      submitLabel={t("common:table.apply")}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <FormField label={t("import:review.action")}>
        {(p) => (
          <Combobox
            {...p}
            className={fieldClass(form.action !== "keep")}
            value={form.action}
            onChange={(v) => setForm((f) => ({ ...f, action: v as BulkForm["action"] }))}
            // Nothing to update: an update could only ever end in "pick the match".
            options={(Object.keys(ACTIONS) as BulkForm["action"][])
              .filter((a) => a !== "update" || preview.targets.length)
              .map((a) => ({ value: a, label: t(ACTIONS[a]) }))}
          />
        )}
      </FormField>
      <FormField label={t("import:review.target")}>
        {(p) => (
          <Combobox
            {...p}
            disabled={!updating}
            className={fieldClass(updating && !!form.target, !updating)}
            value={updating ? (form.target ?? "keep") : "keep"}
            onChange={(v) =>
              setForm((f) => ({ ...f, target: v === "system" ? "system" : undefined }))
            }
            options={[
              { value: "keep", label: t("import:edit.keep") },
              { value: "system", label: t("import:edit.system") },
            ]}
          />
        )}
      </FormField>
      {form.action === "update" && (
        <FormField label={t("import:edit.all")}>
          {(p) => (
            <Combobox
              {...p}
              className={fieldClass(!!form.all)}
              value={form.all ?? "keep"}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  all: v === "overwrite" || v === "keepEdits" ? v : undefined,
                }))
              }
              options={(["keep", "overwrite", "keepEdits"] as const).map((c) => ({
                value: c,
                label: t(CHOICES[c]),
              }))}
            />
          )}
        </FormField>
      )}
      {roots && (
        <FormField label={t("import:projects.columns.folder")}>
          {(p) => {
            const off = form.action === "skip" || form.action === "suggestion";
            const rooted = !off && (folderKind === "moveToRoot" || folderKind === "create");
            return (
              <>
                <Combobox
                  {...p}
                  disabled={off}
                  className={fieldClass(!off && folderKind !== "keep", off)}
                  value={off ? "keep" : folderKind}
                  onChange={(v) => setFolderKind(v as keyof typeof FOLDERS)}
                  options={(Object.keys(FOLDERS) as (keyof typeof FOLDERS)[])
                    .filter((k) => roots.length || (k !== "moveToRoot" && k !== "create"))
                    .map((k) => ({ value: k, label: t(FOLDERS[k]) }))}
                />
                {rooted && roots.length > 1 && (
                  <Combobox
                    aria-label={t("import:edit.root")}
                    value={folderRoot}
                    onChange={setFolderRoot}
                    options={roots.map((r) => ({ value: r.id, label: r.name }))}
                  />
                )}
                {rooted && folderKind === "create" && (
                  <input
                    className={inputClass}
                    aria-label={t("import:projects.folderName")}
                    placeholder={t("import:projects.folderNameHint")}
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                  />
                )}
              </>
            );
          }}
        </FormField>
      )}
      <hr className="border-border" />
      {columns.map((col) => {
        const state = stateOf(col);
        if (state === "hidden") return null;
        const label = t(col.label, col.labelArgs);
        if (state === "readOnly")
          return (
            <div key={col.key} className="flex flex-col gap-1.5">
              <span className="font-medium">{label}</span>
              <span className="text-muted">{readOnlyText(col)}</span>
            </div>
          );
        const disabled = state === "disabled";
        const choices = disabled ? [] : state;
        const field = form.fields[col.key];
        // All columns fills in the rest; a column can differ from it, not opt out of it.
        const inherited = form.all && choices.includes(form.all) ? form.all : undefined;
        const current: Choice =
          field && choices.includes(field.kind) ? field.kind : (inherited ?? "keep");
        const text = current === "value" ? typed(col) : undefined;
        const error = text ? valueError(col, text) : undefined;
        const errorId = `bulk-edit-${col.key}-error`;
        const picks = preview.refOptions?.[col.key];
        const names = col.ref ? preview.refNames[col.ref] : undefined;
        return (
          <FormField key={col.key} label={label}>
            {(p) => (
              <>
                <Combobox
                  {...p}
                  disabled={disabled}
                  className={fieldClass(current !== "keep", disabled)}
                  value={current}
                  onChange={(v) => choose(col.key, v as Choice)}
                  options={[...(inherited ? [] : ["keep" as const]), ...choices].map((c) => ({
                    value: c,
                    label: t(CHOICES[c]),
                  }))}
                />
                {current === "value" &&
                  (picks ? (
                    <Combobox
                      required
                      placeholder={t("import:review.pickTarget")}
                      aria-label={t("import:edit.valueOf", { column: label })}
                      value={field?.kind === "value" ? (field.id ?? "") : ""}
                      onChange={(id) =>
                        setField(col.key, {
                          kind: "value",
                          id,
                          text: [...picks, ...added].find((o) => o.id === id)?.label ?? "",
                        })
                      }
                      options={[...picks, ...(slotOf(col.key) ? added : [])]
                        .filter((o) => !o.empty)
                        .map((o) => ({
                          value: o.id,
                          label: o.id === NO_PROJECT ? t("import:review.noProject") : o.label,
                        }))}
                    />
                  ) : (
                    <CellInput
                      required
                      col={col}
                      label={t("import:edit.valueOf", { column: label })}
                      value={text ?? ""}
                      invalid={!!error}
                      describedBy={error ? errorId : undefined}
                      names={names}
                      optionLabel={optionLabel}
                      onChange={(v) => setField(col.key, { kind: "value", text: v })}
                    />
                  ))}
                {error && (
                  <p id={errorId} className="text-bad">
                    {errorText(error)}
                  </p>
                )}
              </>
            )}
          </FormField>
        );
      })}
    </FormDialog>
  );
}
