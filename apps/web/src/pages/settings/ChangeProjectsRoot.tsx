import type { ProjectFolderRow, ProjectRelinkResult } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import {
  type Column,
  DataTable,
  filtersOf,
  type ListQuery,
  viewOf,
} from "../../components/DataTable.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField } from "../../components/FormField.tsx";
import { RootStateBadge } from "../../components/RootStateBadge.tsx";
import { SelectionBar, SelectionResult } from "../../components/SelectionBar.tsx";
import { cx } from "../../lib/cx.ts";
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
    <>
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
    </>
  );
}

/** The table: filter and select projects, then Change root… on the bar. Mounted while the dialog is open. */
function RelinkForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const rows = useProjectFolders().data ?? [];
  const roots = useRoots();
  const relink = useRelinkProjects();
  const [query, setQuery] = useState<ListQuery>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rootId, setRootId] = useState("");
  const [move, setMove] = useState(false);
  const [editing, setEditing] = useState(false);
  const endSelection = () => {
    setSelected(new Set());
    relink.reset();
  };
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
      {/* Sticks together, so both stay in sight on a long table. */}
      <div
        className={cx("sticky top-2 z-10 grid gap-2", !relink.data && !selected.size && "hidden")}
      >
        <SelectionResult open={!!relink.data} onDismiss={() => relink.reset()}>
          {relink.data && <RelinkSummary result={relink.data} rows={rows} />}
        </SelectionResult>
        <SelectionBar count={selected.size} onClear={endSelection}>
          <Button
            onClick={() => {
              relink.reset();
              setRootId("");
              setMove(false);
              setEditing(true);
            }}
          >
            {t("settings:projects.relink.action")}
          </Button>
        </SelectionBar>
      </div>
      <DataTable
        label={t("settings:projects.relink.table")}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        client={{
          query,
          onQueryChange: (q) => {
            if (filtersOf(q) !== filtersOf(query)) endSelection();
            setQuery(q);
          },
        }}
      />
      <div>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </div>
      <FormDialog
        open={editing}
        title={t("settings:projects.relink.submit", { count: selected.size })}
        submitLabel={t("settings:projects.relink.confirmLabel")}
        busy={relink.isPending}
        error={relink.isError ? t("settings:projects.relink.error") : undefined}
        onCancel={() => setEditing(false)}
        onSubmit={() =>
          relink.mutate(
            { ids: [...selected], rootId, move },
            {
              // Done ones leave the selection; skipped ones stay, listed with why.
              onSuccess: (result) => {
                setSelected(new Set(result.skipped.map((s) => s.id)));
                setEditing(false);
              },
            },
          )
        }
      >
        <FormField label={t("settings:projects.relink.newRoot")}>
          {(p) => (
            <Combobox
              {...p}
              required
              placeholder={t("settings:projects.relink.pickRoot")}
              value={rootId}
              onChange={setRootId}
              options={roots
                .filter((r) => r.canEdit)
                .map((r) => ({ value: r.id, label: rootLabel(r.id) }))}
            />
          )}
        </FormField>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
          {t("settings:projects.relink.moveFiles")}
        </label>
        {/* Says what Change root will do, so no second confirm is needed. */}
        {rootId && (
          <p className="text-muted wrap-anywhere">
            {t(move ? "settings:projects.relink.confirmMove" : "settings:projects.relink.confirm", {
              count: selected.size,
              path: rootLabel(rootId),
            })}
          </p>
        )}
      </FormDialog>
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
