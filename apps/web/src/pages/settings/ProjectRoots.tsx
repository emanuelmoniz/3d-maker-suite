import { ROOT_HUB, type Root } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { RootStateBadge } from "../../components/RootStateBadge.tsx";
import { textLink } from "../../lib/cx.ts";
import { formatNumber } from "../../lib/format.ts";
import { useProjectFolders } from "../../lib/projects.ts";
import { rootErrorKey, useChangeRoot, useRoots } from "../../lib/roots.ts";
import { ChangeProjectsRoot } from "./ChangeProjectsRoot.tsx";

/** The last segment of a path, with either separator. */
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * The project folders as a table. Adding and editing happen on a folder's own page; with the hub
 * on, a folder can be on a machine (ADR-0014, ADR-0021).
 */
export function ProjectRoots() {
  const { t } = useTranslation();
  const roots = useRoots();
  const counts = new Map<string, number>();
  for (const p of useProjectFolders().data ?? [])
    if (p.rootId) counts.set(p.rootId, (counts.get(p.rootId) ?? 0) + 1);
  const save = useChangeRoot();
  const [removing, setRemoving] = useState<Root | null>(null);
  const [location, setLocation] = useState(ROOT_HUB);
  const columns: Column<Root>[] = [
    {
      id: "path",
      header: t("settings:projects.col.folder"),
      className: "min-w-40 whitespace-normal!",
      sortValue: (r) => baseName(r.path),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-x-2">
          <Link
            to="/projects/settings/folders/$id"
            params={{ id: r.id }}
            className={`wrap-anywhere ${textLink}`}
            title={r.path}
            aria-label={t("settings:folder.edit", { path: r.path })}
          >
            {baseName(r.path)}
          </Link>
          <RootStateBadge state={r.state} />
        </span>
      ),
    },
    {
      id: "machine",
      header: t("settings:projects.col.machine"),
      sortValue: (r) => r.deviceName ?? "",
      cell: (r) => r.deviceName ?? t("settings:projects.locationHub"),
    },
    {
      id: "projects",
      header: t("settings:projects.col.projects"),
      numeric: true,
      sortValue: (r) => counts.get(r.id) ?? 0,
      cell: (r) => formatNumber(counts.get(r.id) ?? 0),
    },
    {
      id: "autoSlice",
      header: t("settings:projects.autoSlice"),
      sortValue: (r) => Number(r.autoSlice),
      cell: (r) => t(r.autoSlice ? "settings:projects.on" : "settings:projects.off"),
    },
    {
      id: "remove",
      header: "",
      cell: (r) => (
        <Button
          variant="ghost"
          aria-label={t("settings:projects.removeRoot", { path: r.path })}
          onClick={() => setRemoving(r)}
        >
          <Trash2 className="size-4 text-bad" aria-hidden />
        </Button>
      ),
    },
  ];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/projects/settings/folders/new"
          className="inline-flex h-9 items-center whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90"
        >
          {t("settings:folder.add")}
        </Link>
        <ChangeProjectsRoot />
      </div>
      {roots.length > 0 && (
        <DataTable
          label={t("settings:projects.roots")}
          columns={columns}
          rows={roots}
          rowKey={(r) => r.id}
        />
      )}
      {save.isError && (
        <p role="alert" className="text-bad">
          {t(rootErrorKey(save.error, location))}
        </p>
      )}
      <ConfirmDialog
        open={!!removing}
        destructive
        title={t("settings:projects.removeTitle")}
        description={t("settings:projects.removeConfirm", { path: removing?.path ?? "" })}
        confirmLabel={t("settings:projects.remove")}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) {
            setLocation(removing.location);
            save.mutate({ remove: removing.id });
          }
          setRemoving(null);
        }}
      />
    </div>
  );
}
