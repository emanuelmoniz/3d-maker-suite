import type { ProjectFolderRow, ProjectRelinkResult } from "@3d-maker-suite/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
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
import { ApiError, api } from "../../lib/api.ts";
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
  failed: "settings:projects.relink.skips.failed",
} as const;

type Skipped = {
  id: string;
  code: string;
  usedBy?: ProjectRelinkResult["skipped"][number]["usedBy"];
};
/** What Change folder or Unlink did; `skipped` stay selected. */
type Outcome = { done: string; skipped: Skipped[] };

/** What the last change did: how many were done, and each skipped project with its reason. */
function RelinkSummary({ result, rows }: { result: Outcome; rows: ProjectFolderRow[] }) {
  const { t } = useTranslation();
  return (
    <>
      <p>
        {result.done}{" "}
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
                    : t(SKIPS[s.code as keyof typeof SKIPS] ?? SKIPS.failed),
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
  const qc = useQueryClient();
  const [query, setQuery] = useState<ListQuery>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rootId, setRootId] = useState("");
  const [move, setMove] = useState(false);
  const [editing, setEditing] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  // Unlink and keep: nothing on disk changes, and scans leave the folders alone (`release`).
  const unlink = useMutation({
    mutationFn: async (ids: string[]) => {
      const skipped: Skipped[] = [];
      // ponytail: one request per project, in turn; a bulk endpoint if hundreds at once get slow.
      for (const id of ids)
        await api("DELETE", `/api/projects/${id}/folder?files=keep`).catch((e) =>
          skipped.push({ id, code: e instanceof ApiError ? (e.code ?? "") : "" }),
        );
      return { count: ids.length - skipped.length, skipped };
    },
    onSuccess: (r) => {
      setSelected(new Set(r.skipped.map((s) => s.id)));
      setUnlinking(false);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const outcome: Outcome | undefined = relink.data
    ? {
        done: t("settings:projects.relink.moved", { count: relink.data.moved.length }),
        skipped: relink.data.skipped,
      }
    : unlink.data && {
        done: t("settings:projects.relink.unlinked", { count: unlink.data.count }),
        skipped: unlink.data.skipped,
      };
  const dismiss = () => {
    relink.reset();
    unlink.reset();
  };
  const endSelection = () => {
    setSelected(new Set());
    dismiss();
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
      <div className={cx("sticky top-2 z-10 grid gap-2", !outcome && !selected.size && "hidden")}>
        <SelectionResult open={!!outcome} onDismiss={dismiss}>
          {outcome && <RelinkSummary result={outcome} rows={rows} />}
        </SelectionResult>
        <SelectionBar count={selected.size} onClear={endSelection}>
          <Button
            onClick={() => {
              dismiss();
              setRootId("");
              setMove(false);
              setEditing(true);
            }}
          >
            {t("settings:projects.relink.action")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              dismiss();
              setUnlinking(true);
            }}
          >
            {t("settings:projects.relink.unlink", { count: selected.size })}
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
      <ConfirmDialog
        open={unlinking}
        title={t("settings:projects.relink.unlinkTitle", { count: selected.size })}
        description={t("settings:projects.relink.unlinkBody")}
        confirmLabel={unlink.isPending ? t("common:bulk.working") : t("projects:folder.unlink")}
        onCancel={() => setUnlinking(false)}
        onConfirm={() => {
          if (!unlink.isPending) unlink.mutate([...selected]);
        }}
      >
        {unlink.isError && (
          <p role="alert" className="text-bad">
            {t("projects:folder.error")}
          </p>
        )}
      </ConfirmDialog>
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
