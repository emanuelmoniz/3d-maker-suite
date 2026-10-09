import type { Project } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FolderKanban, LayoutGrid, List, Plus, ScanSearch } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable, type ListQuery, Pager } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FilterBar } from "../../components/FilterBar.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagFilter } from "../../components/TagFilter.tsx";
import { cx } from "../../lib/cx.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { projectThumbnailUrl, useProjectMaterials, useScan } from "../../lib/projects.ts";
import { useCollections } from "../../lib/tags.ts";

type View = "grid" | "list";
const VIEW_KEY = "projects.view";
const storedView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};

const tagline = (p: Project, multicolor: string) =>
  [...p.meta.materials, ...(p.meta.multicolor ? [multicolor] : [])].join(" · ");

function Thumb({ p, className }: { p: Project; className: string }) {
  return p.thumbnailPath ? (
    <img
      src={projectThumbnailUrl(p)}
      alt=""
      loading="lazy"
      className={cx("object-cover", className)}
    />
  ) : (
    <span className={cx("grid place-items-center bg-surface-2 text-muted", className)}>
      <FolderKanban className="size-5" aria-hidden />
    </span>
  );
}

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
  const [view, setView] = useState(storedView);
  // One list query for both views: the filter bar sets filters, the table or pager the rest.
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = useListPage<Project>(["projects", "list"], "/api/projects", query);
  const collections = useCollections().data ?? [];
  const materials = useProjectMaterials().data ?? [];
  const set = (patch: ListQuery, keepPage = false) => {
    const next: ListQuery = { ...query, ...patch };
    if (!keepPage) delete next.page;
    for (const k of Object.keys(next)) if (!next[k]?.trim()) delete next[k];
    setQuery(next);
  };
  const { name = "", tagId = "", collectionId = "", material = "", multicolor = "" } = query;
  const filtered = !!(name || tagId || collectionId || material || multicolor);
  const rows = data?.items ?? [];
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
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
      {data && !data.total && !filtered ? (
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
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <FilterBar
                search={name}
                onSearchChange={(v) => set({ name: v })}
                searchLabel={t("projects:filters.search")}
                onReset={
                  filtered
                    ? () =>
                        set({ name: "", tagId: "", collectionId: "", material: "", multicolor: "" })
                    : undefined
                }
              >
                <TagFilter value={tagId} onChange={(v) => set({ tagId: v })} />
                {collections.length > 0 && (
                  <select
                    aria-label={t("projects:filters.collection")}
                    className={`${inputClass} w-auto`}
                    value={collectionId}
                    onChange={(e) => set({ collectionId: e.target.value })}
                  >
                    <option value="">{t("projects:filters.allCollections")}</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                {materials.length > 0 && (
                  <select
                    aria-label={t("projects:filters.material")}
                    className={`${inputClass} w-auto`}
                    value={material}
                    onChange={(e) => set({ material: e.target.value })}
                  >
                    <option value="">{t("projects:filters.allMaterials")}</option>
                    {materials.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={multicolor === "true"}
                    onChange={(e) => set({ multicolor: e.target.checked ? "true" : "" })}
                  />
                  {t("projects:list.multicolor")}
                </label>
              </FilterBar>
              <fieldset className="m-0 flex gap-1 border-0 p-0">
                <legend className="sr-only">{t("projects:view.label")}</legend>
                {(
                  [
                    ["grid", LayoutGrid, "projects:view.grid"],
                    ["list", List, "projects:view.list"],
                  ] as const
                ).map(([v, Icon, key]) => (
                  <Button
                    key={v}
                    variant={view === v ? "primary" : "secondary"}
                    aria-pressed={view === v}
                    aria-label={t(key)}
                    onClick={() => pick(v)}
                  >
                    <Icon className="size-4" aria-hidden />
                  </Button>
                ))}
              </fieldset>
            </div>
            {!rows.length ? (
              <p className="text-muted">{t("projects:filters.none")}</p>
            ) : view === "grid" ? (
              <div className="flex flex-col gap-3">
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {rows.map((p) => (
                    <li key={p.id}>
                      <Link
                        to="/projects/$id"
                        params={{ id: p.id }}
                        className="block overflow-hidden rounded-lg border border-border bg-surface hover:border-accent"
                      >
                        <Thumb p={p} className="aspect-square w-full" />
                        <span className="block p-2">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block truncate text-muted">
                            {tagline(p, t("projects:list.multicolor")) || "\u00a0"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Pager query={query} total={data.total} onChange={set} />
              </div>
            ) : (
              <DataTable
                label={t("projects:list.table")}
                rows={rows}
                rowKey={(p) => p.id}
                server={{ query, onQueryChange: setQuery, total: data.total }}
                columns={[
                  {
                    id: "name",
                    header: t("projects:list.columns.name"),
                    cell: (p) => (
                      <span className="flex items-center gap-3">
                        <Thumb p={p} className="size-10 rounded" />
                        <span>
                          <Link
                            to="/projects/$id"
                            params={{ id: p.id }}
                            className="block font-medium hover:underline"
                          >
                            {p.name}
                          </Link>
                          {p.description && (
                            <span className="line-clamp-1 block max-w-md text-muted">
                              {p.description}
                            </span>
                          )}
                        </span>
                      </span>
                    ),
                    sort: "name",
                  },
                  {
                    id: "materials",
                    header: t("projects:list.columns.materials"),
                    cell: (p) => tagline(p, t("projects:list.multicolor")),
                  },
                  {
                    id: "files",
                    header: t("projects:list.columns.files"),
                    numeric: true,
                    cell: (p) =>
                      p.folderPath
                        ? t("projects:list.files", { count: p.meta.files.length })
                        : t("projects:list.noFolder"),
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
                ]}
              />
            )}
          </>
        )
      )}
    </>
  );
}
