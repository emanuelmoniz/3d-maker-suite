import { Link } from "@tanstack/react-router";
import { ExternalLink, FolderKanban, Plus, ScanSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { projectThumbnailUrl, useProjects, useScan } from "../../lib/projects.ts";

const linkButton =
  "inline-flex h-9 items-center gap-2 rounded-md px-3 font-medium hover:opacity-90";

function ScanPanel() {
  const { t } = useTranslation();
  const { status, start } = useScan();
  if (!status) return null;
  const running = status.state === "running";
  const discovering = running && status.phase !== "scanning";
  return (
    <div className="mb-4 grid gap-2" role="status" aria-live="polite">
      {running && (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-3">
          <span>
            {discovering
              ? t("projects:scan.discovering")
              : t("projects:scan.progress", { done: status.done, total: status.total })}
          </span>
          <progress
            className="h-2 w-full accent-[var(--accent)]"
            aria-label={t("projects:scan.start")}
            {...(discovering ? {} : { value: status.done, max: Math.max(status.total, 1) })}
          />
        </div>
      )}
      {!running && status.finishedAt && (
        <p className="text-muted">
          {t("projects:scan.done", { created: status.created, updated: status.updated })}
        </p>
      )}
      {!running && status.failed > 0 && (
        <p className="text-bad">{t("projects:scan.failed", { count: status.failed })}</p>
      )}
      {!running &&
        status.missingRoots.map((path) => (
          <p key={path} className="text-bad">
            {t("projects:scan.missingRoot", { path })}
          </p>
        ))}
      {start.isError && (
        <p role="alert" className="text-bad">
          {t("projects:scan.error")}
        </p>
      )}
      <div>
        <Button disabled={running || start.isPending} onClick={() => start.mutate()}>
          <ScanSearch className="size-4" aria-hidden />
          {t("projects:scan.start")}
        </Button>
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const { t } = useTranslation();
  const { data, isError } = useProjects();
  const add = (
    <Link to="/projects/new" className={`${linkButton} bg-accent text-accent-fg`}>
      <Plus className="size-4" aria-hidden />
      {t("projects:list.add")}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t("nav:items.projects.label")}
        description={t("nav:items.projects.description")}
        actions={add}
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("projects:loadError")}
        </p>
      )}
      <ScanPanel />
      {data && !data.total ? (
        <EmptyState
          icon={FolderKanban}
          title={t("projects:list.emptyTitle")}
          description={t("projects:list.emptyBody")}
          action={
            <Link to="/settings" className={`${linkButton} border border-border bg-surface`}>
              {t("projects:list.settings")}
            </Link>
          }
        />
      ) : (
        data && (
          <DataTable
            label={t("projects:list.table")}
            rows={data.items}
            rowKey={(p) => p.id}
            columns={[
              {
                id: "name",
                header: t("projects:list.columns.name"),
                cell: (p) => (
                  <span className="flex items-center gap-3">
                    {p.thumbnailPath ? (
                      <img
                        src={projectThumbnailUrl(p)}
                        alt=""
                        loading="lazy"
                        className="size-10 rounded object-cover"
                      />
                    ) : (
                      <span className="grid size-10 place-items-center rounded bg-surface-2 text-muted">
                        <FolderKanban className="size-5" aria-hidden />
                      </span>
                    )}
                    <span>
                      <span className="block font-medium">{p.name}</span>
                      {p.description && (
                        <span className="line-clamp-1 block max-w-md text-muted">
                          {p.description}
                        </span>
                      )}
                    </span>
                  </span>
                ),
                sortValue: (p) => p.name.toLowerCase(),
              },
              {
                id: "materials",
                header: t("projects:list.columns.materials"),
                cell: (p) =>
                  [
                    ...p.meta.materials,
                    ...(p.meta.multicolor ? [t("projects:list.multicolor")] : []),
                  ].join(" · "),
              },
              {
                id: "files",
                header: t("projects:list.columns.files"),
                numeric: true,
                cell: (p) =>
                  p.folderPath
                    ? t("projects:list.files", { count: p.meta.files.length })
                    : t("projects:list.noFolder"),
                sortValue: (p) => p.meta.files.length,
              },
              {
                id: "source",
                header: t("projects:list.columns.source"),
                cell: (p) =>
                  p.sourceUrl && (
                    <a
                      href={p.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t("projects:list.openSource")}
                      className="inline-flex text-muted hover:text-fg"
                    >
                      <ExternalLink className="size-4" aria-hidden />
                    </a>
                  ),
              },
              {
                id: "actions",
                header: "",
                cell: (p) => (
                  <span className="flex justify-end">
                    <Link to="/projects/$id/edit" params={{ id: p.id }} className="hover:underline">
                      {t("projects:list.edit")}
                    </Link>
                  </span>
                ),
              },
            ]}
          />
        )
      )}
    </>
  );
}
