import {
  bestMatches,
  type Project,
  type ProjectDetail,
  ROOT_HUB,
  sumCosts,
} from "@3d-maker-suite/core";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Box, ExternalLink, FolderOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Collapsible } from "../../components/Collapsible.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import {
  CostBreakdown,
  MaterialUsage,
  PrinterHint,
  ProductionCost,
} from "../../components/CostBreakdown.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { RootStateBadge } from "../../components/RootStateBadge.tsx";
import { TagList } from "../../components/TagList.tsx";
import { Write } from "../../components/Write.tsx";
import { ApiError } from "../../lib/api.ts";
import { estimateSlicedPlates, useCostContext } from "../../lib/cost.ts";
import { cx } from "../../lib/cx.ts";
import { useProfiles, useSpools } from "../../lib/filament.ts";
import { formatDuration, formatWeight } from "../../lib/format.ts";
import { useCapable, useIntegrationLabel } from "../../lib/integrations.ts";
import { useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { usePrints, usePrintsOfProject } from "../../lib/prints.ts";
import {
  galleryImages,
  projectDocResolver,
  projectFileUrl,
  projectName,
  projectThumbnailUrl,
  useDeleteProject,
  useOpenProject,
  useProject,
  useProjectSlicing,
} from "../../lib/projects.ts";
import { useRoots } from "../../lib/roots.ts";
import { useTagsOf } from "../../lib/tags.ts";
import { OrdersTable } from "../orders/OrdersTable.tsx";
import { PrintsTable } from "../prints/PrintsPage.tsx";
import { QuotesTable } from "../quotes/QuotesTable.tsx";
import { ModelPreview } from "./ModelPreview.tsx";
import { DeviceFileList, ProjectFiles } from "./ProjectFiles.tsx";
import { MissingFolderBanner } from "./ProjectFolder.tsx";
import { ProjectGallery } from "./ProjectGallery.tsx";

const linkButton =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2";
const DELETE_ERRORS = {
  project_has_prints: "projects:remove.errors.project_has_prints",
  project_in_order: "projects:remove.errors.project_in_order",
  folder_has_files: "projects:remove.errors.folder_has_files",
} as const;

/** Delete, confirmed; the dialog stays open with the reason when the server refuses. */
function DeleteProject({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const del = useDeleteProject(project.id);
  const [open, setOpen] = useState(false);
  const code = del.error instanceof ApiError ? del.error.code : undefined;
  return (
    <>
      <Button
        onClick={() => {
          del.reset();
          setOpen(true);
        }}
      >
        {t("projects:remove.action")}
      </Button>
      <ConfirmDialog
        open={open}
        title={t("projects:remove.title", { name: projectName(t, project) })}
        description={
          project.folderPath
            ? t("projects:remove.bodyFolder")
            : project.unlinkedFolder
              ? t("projects:remove.bodyKept", { path: project.unlinkedFolder })
              : t("projects:remove.body")
        }
        confirmLabel={t("projects:remove.action")}
        destructive
        onCancel={() => setOpen(false)}
        onConfirm={() => del.mutate(undefined, { onSuccess: () => navigate({ to: "/projects" }) })}
      >
        {del.isError && (
          <p role="alert" className="text-bad">
            {t(
              code && code in DELETE_ERRORS
                ? DELETE_ERRORS[code as keyof typeof DELETE_ERRORS]
                : "projects:remove.error",
            )}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
const VIEWABLE = /\.(3mf|stl)$/i;
const SLICED_EXPORT = /\.gcode\.3mf$/i;
// The project folder, or with a configured root above it, the path from that root's folder down.
const folderLabel = (path: string, roots: string[]) => {
  const parts = (p: string) => p.split(/[\\/]/).filter(Boolean);
  const sep = path.includes("\\") ? "\\" : "/";
  const own = parts(path);
  const root = roots
    .map(parts)
    .filter(
      (r) => r.length < own.length && r.every((d, i) => d.toLowerCase() === own[i]?.toLowerCase()),
    )
    .sort((x, y) => y.length - x.length)[0];
  return (root ? own.slice(root.length - 1) : own.slice(-1)).join(sep);
};

// Static keys so `pnpm i18n:check` sees them; `api()` puts the HTTP status last in the message.
const openError = (t: TFunction, message: string) =>
  message.endsWith(": 409")
    ? t("projects:detail.openFailed.no_slicer")
    : message.endsWith(": 403")
      ? t("projects:detail.openFailed.not_allowed")
      : t("projects:detail.openFailed.launch_failed");

function Plates({
  project,
  file,
  plate,
  onPlate,
}: {
  project: Project;
  file: string;
  plate: number | null;
  onPlate: (index: number | null) => void;
}) {
  const { t } = useTranslation();
  const prints = usePrintsOfProject(project.id).data?.items ?? [];
  // The app's own slices of this file's plates (the 3MF's slice data wins when it has some).
  const setups = useProjectSlicing(project.id).data?.plates ?? [];
  const model = project.meta.models.find((m) => m.file === file);
  if (!model?.plates.length) return null;
  const threeMfs = project.meta.models;
  // Stands in for slice results the file doesn't have: the newest good print of this file's plate.
  const lastPrintLine = (index: number) => {
    const last = prints.find(
      (p) =>
        p.outcome === "success" &&
        p.durationSec != null &&
        p.plate === index &&
        (threeMfs.length === 1 ||
          bestMatches(p.title, threeMfs, (m) => m.file.split("/").pop() ?? "").includes(model)),
    );
    return last?.durationSec != null
      ? t("projects:detail.lastPrint", {
          time: formatDuration(last.durationSec),
          weight: formatWeight(last.usages.reduce((g, u) => g + u.grams, 0)),
        })
      : null;
  };
  return (
    <Collapsible title={t("projects:detail.plates")}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {model.plates.length > 1 && (
          <li>
            <button
              type="button"
              aria-pressed={plate === null}
              onClick={() => onPlate(null)}
              className={cx(
                "flex w-full gap-3 rounded-lg border bg-surface p-2 text-left hover:bg-surface-2",
                plate === null ? "border-accent" : "border-border",
              )}
            >
              {/* A mosaic of the plate previews (up to 9). */}
              <span
                className={cx(
                  "grid size-20 shrink-0 gap-px overflow-hidden rounded bg-surface-2",
                  model.plates.length > 4 ? "grid-cols-3" : "grid-cols-2",
                )}
              >
                {model.plates
                  .slice(0, 9)
                  .map((p) =>
                    p.thumbnail ? (
                      <img
                        key={p.index}
                        src={projectFileUrl(project.id, file, p.thumbnail)}
                        alt=""
                        loading="lazy"
                        className="size-full object-contain"
                      />
                    ) : (
                      <span key={p.index} />
                    ),
                  )}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{t("projects:detail.viewAll")}</span>
                <span className="block text-muted">
                  {t("projects:detail.viewAllHint", { count: model.plates.length })}
                </span>
              </span>
            </button>
          </li>
        )}
        {model.plates.map((p) => {
          const setup = setups.find((s) => s.file === file && s.plate === p.index);
          const result = p.sliced ? null : setup?.result;
          const grams = (slot: number) =>
            p.filaments.find((f) => f.slot === slot)?.grams ??
            result?.filaments.find((f) => f.slot === slot)?.grams ??
            null;
          return (
            <li key={p.index}>
              <button
                type="button"
                aria-pressed={plate === p.index}
                onClick={() => onPlate(plate === p.index ? null : p.index)}
                className={cx(
                  "flex w-full gap-3 rounded-lg border bg-surface p-2 text-left hover:bg-surface-2",
                  plate === p.index ? "border-accent" : "border-border",
                )}
              >
                {p.thumbnail ? (
                  <img
                    src={projectFileUrl(project.id, file, p.thumbnail)}
                    alt=""
                    loading="lazy"
                    className="size-20 shrink-0 rounded bg-surface-2 object-contain"
                  />
                ) : (
                  <span className="size-20 shrink-0 rounded bg-surface-2" />
                )}
                <span className="min-w-0">
                  <span className="block font-medium">
                    {p.name ?? t("projects:detail.plate", { index: p.index })}
                  </span>
                  <span className="block text-muted">
                    {p.sliced && p.printTimeSeconds != null
                      ? [
                          formatDuration(p.printTimeSeconds),
                          p.weightGrams != null && formatWeight(p.weightGrams),
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : !p.sliced && setup?.job
                        ? t("projects:detail.slicing")
                        : result
                          ? [
                              formatDuration(result.printTimeSeconds),
                              formatWeight(result.weightGrams),
                              setup?.needsSlicing && t("projects:detail.sliceOutdated"),
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : (lastPrintLine(p.index) ??
                            (p.slicedOnSave
                              ? t("projects:detail.slicedNoData")
                              : t("projects:detail.notSliced")))}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {p.filaments.map((f) => (
                      <span key={f.slot} className="inline-flex items-center gap-1 text-xs">
                        <span
                          aria-hidden
                          className="size-3 rounded-full border border-border"
                          style={{ backgroundColor: f.color?.slice(0, 7) ?? "transparent" }}
                        />
                        {f.type ?? t("projects:detail.unknownMaterial")}
                        {grams(f.slot) != null && ` ${formatWeight(grams(f.slot) as number)}`}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Collapsible>
  );
}

function LinkedPrints({ id }: { id: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useUrlListQuery("prints.");
  const prints = usePrints({ ...query, projectId: id });
  if (!prints.data || (!prints.data.total && !Object.keys(query).length)) return null;
  return (
    <Collapsible title={t("projects:detail.prints")}>
      <PrintsTable data={prints.data} query={query} onQueryChange={setQuery} hideProject />
    </Collapsible>
  );
}

/**
 * The slice data a 3MF was saved with, as app slices without a setup: the fallback when the app
 * sliced nothing yet. Files with no sliced plate are left out.
 */
const savedSlices = (project: Project) =>
  project.meta.models
    .filter((m) => m.plates.some((p) => p.sliced))
    .flatMap((m) =>
      m.plates.map((p) => ({
        printerId: null,
        spools: [],
        filaments: [],
        result:
          p.sliced && p.printTimeSeconds != null
            ? {
                printTimeSeconds: p.printTimeSeconds,
                weightGrams: p.weightGrams ?? 0,
                filaments: p.filaments.map((f) => ({
                  slot: f.slot,
                  grams: f.grams ?? 0,
                  material: f.type,
                })),
                slicedAt: project.updatedAt,
              }
            : null,
      })),
    );

/** One print of the whole project, from its sliced plates (else the 3MF's), on the default printer. */
function SlicedEstimate({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const own = useProjectSlicing(project.id).data?.plates ?? [];
  const plates = own.some((p) => p.result) ? own : savedSlices(project);
  const ctx = useCostContext().data;
  const defaultId = usePreferences().data?.values.defaultPrinterId;
  const profiles = useProfiles().data?.items ?? [];
  const spools = useSpools().data?.items ?? [];
  const sliced = plates.filter((p) => p.result).length;
  // Its plates are of files in a folder it doesn't have now (unlinked and kept, or missing).
  if (!ctx || project.folderState !== "ok") return null;
  const setUp = (
    <Write when={project.canEdit}>
      <Link
        to="/projects/$id/edit"
        params={{ id: project.id }}
        hash="slicing"
        className={linkButton}
      >
        {t("projects:detail.setUpSlicing")}
      </Link>
    </Write>
  );
  if (!sliced)
    return project.meta.models.length ? (
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-1 font-medium">{t("costs:project.onePrint")}</h3>
        <p className="mb-2 text-muted">{t("projects:detail.setUpHint")}</p>
        {setUp}
      </div>
    ) : null;
  const fallback = ctx.printers.find((p) => p.id === defaultId) ?? ctx.printers[0];
  const used = new Set(plates.filter((p) => p.result).map((p) => p.printerId ?? fallback?.id));
  const estimate = estimateSlicedPlates(plates, ctx, {
    spools,
    profiles,
    fallbackPrinterId: fallback?.id,
  });
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 font-medium">{t("costs:project.onePrint")}</h3>
      <div className="mb-2">
        <PrinterHint printers={ctx.printers} used={[...used]} />
      </div>
      {sliced < plates.length && (
        <p className="mb-2 text-warn">
          {t("costs:project.partial", { sliced, total: plates.length })}
        </p>
      )}
      <div className="grid gap-3">
        <MaterialUsage estimate={estimate} />
        <ProductionCost cost={estimate.cost} />
      </div>
      <div className="mt-3">{setUp}</div>
    </div>
  );
}

function PrintedCost({ id }: { id: string }) {
  const { t } = useTranslation();
  const prints = usePrintsOfProject(id).data?.items ?? [];
  if (!prints.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-2 font-medium">{t("costs:project.printed")}</h3>
      <CostBreakdown cost={sumCosts(prints.map((p) => p.cost))} />
    </div>
  );
}

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: project, isError } = useProject(id);
  const tags = useTagsOf("project")(id);
  const [picked, setPicked] = useState<string | null>(null);
  // null: the whole file ("View all").
  const [plate, setPlate] = useState<number | null>(null);
  const allRoots = useRoots();
  const roots = allRoots.map((r) => r.path);
  // A device root's files open on the device, not here: they're only viewed and downloaded.
  const onDevice = allRoots.some((r) => r.id === project?.rootId && r.location !== ROOT_HUB);
  const open = useOpenProject(id);
  // The default slicer, or the one picked when several are set up (Settings > Integrations).
  const slicers = useCapable("openInSlicer");
  const integrationLabel = useIntegrationLabel();
  const defaultSlicer = usePreferences().data?.values.defaultSlicerId;
  const [slicerId, setSlicerId] = useState<string>();
  const slicer =
    slicers.find((s) => s.id === slicerId) ??
    slicers.find((s) => s.id === defaultSlicer) ??
    slicers[0];

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("projects:detail.notFound")}
      </p>
    );
  if (!project) return null;

  // A missing folder serves no files: only the stored thumbnail is shown until it is fixed.
  const ok = project.folderState === "ok";
  // A device project's gallery is kept on the hub: it shows offline too.
  const hasGallery = (ok || project.folderState === "offline") && galleryImages(project).length > 0;
  // A sliced export the scanner folded into its project file is not a model of its own.
  const models = (ok ? project.meta.files : []).filter(
    (f) =>
      f.kind === "model" &&
      !(SLICED_EXPORT.test(f.path) && !project.meta.models.some((m) => m.file === f.path)),
  );
  // Default: the scanner's main file, else the first model.
  const main = models.find((f) => f.path === project.filePath);
  const current = models.find((f) => f.path === picked) ?? main ?? models[0];
  const info = project.meta.models.find((m) => m.file === current?.path);
  const selected = info?.plates.find((p) => p.index === plate) ?? null;
  const thumb = selected?.thumbnail ?? info?.plates.find((p) => p.thumbnail)?.thumbnail;
  const thumbnail =
    current && thumb
      ? projectFileUrl(project.id, current.path, thumb)
      : project.thumbnailPath
        ? projectThumbnailUrl(project)
        : null;
  // No 3D file and no folder-level fallback thumbnail: nothing to preview.
  const hasPreview = !!current || !!thumbnail;

  return (
    <>
      <PageHeader
        title={projectName(t, project)}
        backTo={{ to: "/projects" }}
        actions={
          <>
            {project.sourceUrl && (
              <a href={project.sourceUrl} target="_blank" rel="noreferrer" className={linkButton}>
                <ExternalLink className="size-4" aria-hidden />
                {t("projects:detail.source")}
              </a>
            )}
            <Write when={project.canEdit}>
              {ok && !onDevice && current && slicer && (
                <span className="flex gap-1">
                  {slicers.length > 1 && (
                    <Combobox
                      aria-label={t("projects:detail.slicerPick")}
                      className={linkButton}
                      value={slicer.id}
                      onChange={setSlicerId}
                      options={slicers.map((s) => ({
                        value: s.id,
                        label: integrationLabel(s),
                      }))}
                    />
                  )}
                  <button
                    type="button"
                    className={linkButton}
                    onClick={() =>
                      open.mutate({
                        target: "slicer",
                        file: current.path,
                        integrationId: slicer.id,
                      })
                    }
                  >
                    <Box className="size-4" aria-hidden />
                    {t("projects:detail.openSlicer")}
                  </button>
                </span>
              )}
              {ok && !onDevice && (
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => open.mutate({ target: "folder" })}
                >
                  <FolderOpen className="size-4" aria-hidden />
                  {t("projects:detail.openFolder")}
                </button>
              )}
              <Link to="/projects/$id/edit" params={{ id }} className={linkButton}>
                {t("projects:list.edit")}
              </Link>
              <DeleteProject project={project} />
            </Write>
          </>
        }
      />
      {(ok || project.folderState === "offline") && project.folderPath && (
        <p className="-mt-3 mb-4 flex flex-wrap items-center gap-2 break-all text-muted">
          {folderLabel(project.folderPath, roots)}
          {project.folderState === "offline" && <RootStateBadge state="offline" />}
        </p>
      )}
      {project.owner && (
        <p className="-mt-3 mb-4 text-muted">
          {t(project.canEdit ? "projects:detail.owner" : "projects:detail.ownerReadOnly", {
            name: project.owner.displayName,
          })}
        </p>
      )}
      <MissingFolderBanner project={project} />
      <p role="status" className={open.isError ? "text-bad" : "sr-only"}>
        {open.isError
          ? openError(t, open.error.message)
          : open.isSuccess
            ? t("projects:detail.opened")
            : ""}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {hasGallery && <ProjectGallery project={project} />}
        {hasPreview && (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="relative lg:min-h-112 lg:flex-1">
              {current ? (
                <ModelPreview
                  projectId={project.id}
                  path={current.path}
                  url={projectFileUrl(project.id, current.path)}
                  ext={current.path.slice(current.path.lastIndexOf(".")).toLowerCase()}
                  size={current.size}
                  items={selected?.items ?? []}
                  partColors={info?.partColors ?? []}
                  thumbnail={thumbnail}
                  name={project.name}
                />
              ) : (
                thumbnail && (
                  <img
                    src={thumbnail}
                    alt={projectName(t, project)}
                    className="w-full rounded-lg border border-border"
                  />
                )
              )}
            </div>
            {models.length > 1 && (
              <label className="grid content-start gap-1 lg:h-16">
                <span className="text-muted">{t("projects:detail.model")}</span>
                <Combobox
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                  value={current?.path ?? ""}
                  onChange={(v) => {
                    setPicked(v);
                    setPlate(null);
                  }}
                  options={models.map((f) => ({
                    value: f.path,
                    label: VIEWABLE.test(f.path)
                      ? f.path
                      : `${f.path} (${t("projects:viewer.noPreview")})`,
                  }))}
                />
              </label>
            )}
          </div>
        )}
        {!hasGallery && (
          <div className="grid min-w-0 content-start gap-4 [&>section]:mt-0">
            <SlicedEstimate project={project} />
            <PrintedCost id={id} />
            {tags.length > 0 && <TagList tags={tags} />}
          </div>
        )}
      </div>

      {current && <Plates project={project} file={current.path} plate={plate} onPlate={setPlate} />}
      {hasGallery && (
        <>
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
            <SlicedEstimate project={project} />
            <PrintedCost id={id} />
          </div>
          {tags.length > 0 && <TagList tags={tags} />}
        </>
      )}
      {project.description && (
        <Collapsible title={t("projects:detail.description")} defaultOpen>
          <div className="rounded-lg border border-border bg-surface p-4">
            {project.descriptionFile?.toLowerCase().endsWith(".txt") ? (
              <p className="whitespace-pre-line">{project.description}</p>
            ) : (
              <Markdown resolve={projectDocResolver(project, project.descriptionFile)}>
                {project.description}
              </Markdown>
            )}
          </div>
        </Collapsible>
      )}

      <LinkedPrints id={id} />
      <QuotesTable fixed={{ projectId: id }} title={t("costs:saved.title")} />
      <OrdersTable fixed={{ projectId: id }} title={t("orders:list.table")} />

      {onDevice ? (
        <DeviceFileList project={project} />
      ) : (
        project.folderState !== "missing" && <ProjectFiles project={project} />
      )}
    </>
  );
}
