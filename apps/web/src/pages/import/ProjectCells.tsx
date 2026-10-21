import type {
  FsListResponse,
  ImportDecision,
  ImportPreview,
  ImportPreviewRow,
} from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { SearchPicker } from "../../components/SearchPicker.tsx";
import { api } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";

type Suggestions = { suggested: Record<string, string[]>; prints: { id: string; label: string }[] };
type Ask = { row: number; targetId?: string | null; folder?: string | null };

/** The folder a project row ends up with: the one picked in the review, else the file's. */
export const folderOf = (r: ImportPreviewRow, d: ImportDecision) =>
  d.folder === undefined
    ? typeof r.values.folder === "string"
      ? r.values.folder
      : null
    : d.folder && "path" in d.folder
      ? d.folder.path
      : null;

const ask = (rows: Ask[]) => api<Suggestions>("POST", "/api/import/projects/prints", { rows });

/**
 * The prints each project row gets, as linking would give them (read once for the file), and a
 * re-read of one row when its folder changes.
 */
export function useProjectPrints(preview: ImportPreview, enabled: boolean) {
  const [again, setAgain] = useState<Record<number, string[]>>({});
  const all = useQuery({
    queryKey: ["import-project-prints", preview.uploadId],
    queryFn: () =>
      ask(
        preview.rows
          .filter((r) => r.status !== "invalid")
          .map((r) => ({
            row: r.row,
            targetId: r.targetId,
            folder: typeof r.values.folder === "string" ? r.values.folder : null,
          })),
      ),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return {
    options: all.data?.prints ?? [],
    of: (row: number) => again[row] ?? all.data?.suggested[row] ?? [],
    refresh: async (a: Ask) => {
      const res = await ask([a]);
      setAgain((s) => ({ ...s, [a.row]: res.suggested[a.row] ?? [] }));
    },
  };
}

/**
 * A project row's folder: the file's, one picked inside the project roots, one the app makes, or
 * none. A row without one, or whose folder isn't there, is highlighted. A picked folder that has
 * files already asks whether its scan names the project instead of the file.
 */
export function FolderCell({
  row,
  decision,
  roots,
  targetFolder,
  onChange,
}: {
  row: ImportPreviewRow;
  decision: ImportDecision;
  roots: string[];
  /** The folder the matched project has now: keeping it asks nothing. */
  targetFolder: string | null;
  onChange: (patch: Pick<ImportDecision, "folder" | "fromFolder">) => void;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [root, setRoot] = useState(roots[0] ?? "");
  const folder = folderOf(row, decision);
  const create = decision.folder && "create" in decision.folder ? decision.folder : null;
  const missing = !create && (!folder || (decision.folder === undefined && !!row.folderMissing));
  const files = useQuery({
    queryKey: ["fs", folder, "file"],
    queryFn: () =>
      api<FsListResponse>(
        "GET",
        `/api/fs/list?${new URLSearchParams({ path: folder ?? "", mode: "file" })}`,
      ),
    enabled: !!folder && folder !== targetFolder && !missing,
    retry: false,
  });
  const hasFiles = !!files.data?.entries.length;

  return (
    <span className="flex max-w-96 flex-col gap-2">
      <span
        className={cx(
          "break-all",
          missing && "rounded-md px-2 py-1 font-medium text-warn ring-1 ring-warn",
        )}
      >
        {create
          ? create.name?.trim()
            ? t("import:projects.toCreate", { name: create.name.trim() })
            : t("import:projects.toCreateNamed")
          : folder
            ? row.folderMissing && decision.folder === undefined
              ? t("import:projects.missing", { path: folder })
              : folder
            : t("import:projects.noFolder")}
      </span>
      <span className="flex flex-wrap gap-2">
        <PathPicker
          label={t("import:projects.pickFor", { row: row.row })}
          mode="folder"
          within={roots}
          initial={folder && !missing ? folder : roots[0]}
          onPick={(path) => onChange({ folder: { path }, fromFolder: undefined })}
        >
          {t("import:projects.pick")}
        </PathPicker>
        <Button disabled={!roots.length} onClick={() => setCreating(true)}>
          {t("import:projects.create")}
        </Button>
        {(folder || create) && (
          <Button variant="ghost" onClick={() => onChange({ folder: null, fromFolder: undefined })}>
            {t("import:projects.none")}
          </Button>
        )}
      </span>
      {hasFiles && (
        <span role="alert" className="flex flex-col gap-1 text-warn">
          {t("import:projects.hasFiles")}
          <label className="flex items-center gap-2 text-fg">
            <input
              type="checkbox"
              checked={!!decision.fromFolder}
              onChange={(e) => onChange({ folder: decision.folder, fromFolder: e.target.checked })}
            />
            {t("import:projects.fromFolder")}
          </label>
        </span>
      )}
      <ConfirmDialog
        open={creating}
        title={t("import:projects.createTitle")}
        description={t("import:projects.createBody")}
        confirmLabel={t("import:projects.create")}
        onCancel={() => setCreating(false)}
        onConfirm={() => {
          setCreating(false);
          onChange({
            folder: { create: true, name: name.trim() || undefined, root: root || undefined },
            fromFolder: undefined,
          });
        }}
      >
        <FormField
          label={t("import:projects.folderName")}
          hint={t("import:projects.folderNameHint")}
        >
          {(p) => (
            <input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          )}
        </FormField>
        {roots.length > 1 && (
          <FormField label={t("import:projects.root")}>
            {(p) => (
              <Combobox
                {...p}
                value={root}
                onChange={setRoot}
                options={roots.map((r) => ({ value: r, label: r }))}
              />
            )}
          </FormField>
        )}
      </ConfirmDialog>
    </span>
  );
}

/** The prints a project row gets: the suggestion until changed here. */
export function PrintsCell({
  row,
  ids,
  options,
  onChange,
}: {
  row: number;
  ids: string[];
  options: { id: string; label: string }[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string[] | null>(null);
  return (
    <>
      <Button
        aria-label={t("import:projects.printsFor", { row, count: ids.length })}
        onClick={() => setDraft(ids)}
      >
        {t("import:projects.prints", { count: ids.length })}
      </Button>
      <ConfirmDialog
        open={!!draft}
        title={t("import:projects.printsTitle", { row })}
        description={t("import:projects.printsBody")}
        onCancel={() => setDraft(null)}
        onConfirm={() => {
          if (draft) onChange(draft);
          setDraft(null);
        }}
      >
        <SearchPicker
          label={t("import:projects.printsLabel")}
          options={options}
          value={draft ?? []}
          onChange={setDraft}
        />
      </ConfirmDialog>
    </>
  );
}
