import type { ProjectFolderRow, ProjectRelinkResult } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { type Column, DataTable, type ListQuery, viewOf } from "../../components/DataTable.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { RootStateBadge } from "../../components/RootStateBadge.tsx";
import { projectName, useProjectFolders, useRelinkProjects } from "../../lib/projects.ts";
import { useRoots } from "../../lib/roots.ts";

const SKIPS = {
  not_found: "settings:projects.relink.skips.not_found",
  forbidden: "settings:projects.relink.skips.forbidden",
  no_folder: "settings:projects.relink.skips.no_folder",
  same_root: "settings:projects.relink.skips.same_root",
  folder_in_use: "settings:projects.relink.skips.folder_in_use",
  scan_failed: "settings:projects.relink.skips.scan_failed",
  move_unavailable: "settings:projects.relink.skips.move_unavailable",
  folder_exists: "settings:projects.relink.skips.folder_exists",
  invalid_folder: "settings:projects.relink.skips.invalid_folder",
  move_failed: "settings:projects.relink.skips.move_failed",
} as const;

/** What the last change did: how many moved, and each skipped project with its reason. */
function RelinkSummary({
  result,
  rows,
}: {
  result: ProjectRelinkResult;
  rows: ProjectFolderRow[];
}) {
  const { t } = useTranslation();
  return (
    <div role="status" className="grid gap-1">
      <p>
        {t("settings:projects.relink.moved", { count: result.moved.length })}{" "}
        {result.skipped.length > 0 &&
          t("settings:projects.relink.skipped", { count: result.skipped.length })}
      </p>
      {result.skipped.length > 0 && (
        <ul className="list-disc pl-5 text-muted">
          {result.skipped.map((s) => {
            const row = rows.find((r) => r.id === s.id);
            return (
              <li key={s.id} className="wrap-anywhere">
                {t("settings:projects.relink.skip", {
                  project: row ? projectName(t, row) : s.id,
                  reason: s.usedBy
                    ? t("settings:projects.relink.skips.used_by", {
                        project: projectName(t, s.usedBy),
                      })
                    : t(SKIPS[s.code]),
                })}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The table: filter and select projects, pick the new root, confirm. Mounted while the dialog is open. */
function RelinkForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const rows = useProjectFolders().data ?? [];
  const roots = useRoots();
  const relink = useRelinkProjects();
  const [query, setQuery] = useState<ListQuery>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rootId, setRootId] = useState("");
  const [move, setMove] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rootLabel = (id: string | null) => {
    const r = roots.find((x) => x.id === id);
    if (!r) return "";
    return r.deviceName
      ? t("settings:projects.relink.rootOn", { path: r.path, device: r.deviceName })
      : r.path;
  };

  const dataColumns: Column<ProjectFolderRow>[] = [
    {
      id: "name",
      header: t("settings:projects.relink.project"),
      archivedMark: true,
      cell: (r) => projectName(t, r),
      sortValue: (r) => r.number,
      filterValue: (r) => projectName(t, r),
    },
    {
      id: "root",
      header: t("settings:projects.relink.root"),
      cell: (r) => rootLabel(r.rootId),
      sortValue: (r) => rootLabel(r.rootId),
      filterValue: (r) => r.rootId ?? "",
      filterOptions: roots.map((r) => ({ value: r.id, label: rootLabel(r.id) })),
    },
    {
      id: "folder",
      header: t("settings:projects.relink.folder"),
      cell: (r) => r.folder,
      sortValue: (r) => r.folder ?? "",
      filterValue: (r) => r.folder ?? "",
    },
    {
      id: "state",
      header: t("settings:projects.relink.state"),
      cell: (r) =>
        r.folderState === "ok" ? (
          t("settings:projects.relink.stateOk")
        ) : (
          <RootStateBadge state={r.folderState ?? "missing"} />
        ),
      sortValue: (r) => r.folderState ?? "",
      filterValue: (r) => r.folderState ?? "",
      filterOptions: [
        { value: "ok", label: t("settings:projects.relink.stateOk") },
        { value: "missing", label: t("common:rootState.missing") },
        { value: "offline", label: t("common:rootState.offline") },
      ],
    },
  ];
  // Filters and sort cover every row, then it is paged: "select all" acts on all the filtered ones.
  const visible = viewOf(dataColumns, rows, query).filter((r) => r.canEdit);
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const someSelected = visible.some((r) => selected.has(r.id));
  const columns: Column<ProjectFolderRow>[] = [
    {
      id: "select",
      header: "",
      headerCell: (
        <input
          type="checkbox"
          aria-label={t("settings:projects.relink.selectAll", { count: visible.length })}
          checked={allSelected}
          disabled={!visible.length}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected;
          }}
          onChange={() =>
            setSelected((s) => {
              const next = new Set(s);
              for (const r of visible) allSelected ? next.delete(r.id) : next.add(r.id);
              return next;
            })
          }
        />
      ),
      cell: (r) => (
        <input
          type="checkbox"
          aria-label={t("settings:projects.relink.select", { project: projectName(t, r) })}
          checked={selected.has(r.id)}
          disabled={!r.canEdit}
          onChange={() =>
            setSelected((s) => {
              const next = new Set(s);
              if (!next.delete(r.id)) next.add(r.id);
              return next;
            })
          }
        />
      ),
    },
    ...dataColumns,
  ];

  return (
    <div className="grid gap-4">
      <p className="text-muted">{t("settings:projects.relink.hint")}</p>
      {relink.data && <RelinkSummary result={relink.data} rows={rows} />}
      <DataTable
        label={t("settings:projects.relink.table")}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        client={{ query, onQueryChange: setQuery }}
      />
      <label className="flex flex-wrap items-center gap-2">
        <span>{t("settings:projects.relink.newRoot")}</span>
        <select
          className={`${inputClass} w-auto! max-w-full min-w-0`}
          value={rootId}
          onChange={(e) => setRootId(e.target.value)}
        >
          <option value="">{t("settings:projects.relink.pickRoot")}</option>
          {roots
            .filter((r) => r.canEdit)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {rootLabel(r.id)}
              </option>
            ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
        {t("settings:projects.relink.moveFiles")}
      </label>
      {relink.isError && (
        <p role="alert" className="text-bad">
          {t("settings:projects.relink.error")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!selected.size || !rootId || relink.isPending}
          onClick={() => setConfirming(true)}
        >
          {t("settings:projects.relink.submit", { count: selected.size })}
        </Button>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t("settings:projects.relink.confirmTitle")}
        description={t(
          move ? "settings:projects.relink.confirmMove" : "settings:projects.relink.confirm",
          {
            count: selected.size,
            path: rootLabel(rootId),
          },
        )}
        confirmLabel={t("settings:projects.relink.confirmLabel")}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          relink.mutate(
            { ids: [...selected], rootId, move },
            { onSuccess: () => setSelected(new Set()) },
          );
        }}
      />
    </div>
  );
}

/**
 * Changes the root of many projects: same relative folders. The files stay where they are, unless
 * "Move files" takes them along.
 */
export function ChangeProjectsRoot() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>{t("settings:projects.relink.open")}</Button>
      <AddDialog
        open={open}
        wide
        title={t("settings:projects.relink.title")}
        onClose={() => setOpen(false)}
      >
        <RelinkForm onClose={() => setOpen(false)} />
      </AddDialog>
    </div>
  );
}
