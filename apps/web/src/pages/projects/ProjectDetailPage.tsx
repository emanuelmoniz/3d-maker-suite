import { bestMatches, type Project, sumCosts } from "@3d-maker-suite/core";
import { Link, useParams } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Box, ExternalLink, FolderOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CostBreakdown } from "../../components/CostBreakdown.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagList } from "../../components/TagList.tsx";
import { estimatePlate, type Plate, useCostContext } from "../../lib/cost.ts";
import { cx } from "../../lib/cx.ts";
import { formatDateTime, formatDuration, formatWeight } from "../../lib/format.ts";
import { useAdapterName, useCapable } from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { usePrintsOfProject } from "../../lib/prints.ts";
import {
  projectFileUrl,
  projectThumbnailUrl,
  useOpenProject,
  useProject,
} from "../../lib/projects.ts";
import { useTagsOf } from "../../lib/tags.ts";
import { ModelPreview } from "./ModelPreview.tsx";

const linkButton =
  "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2";
const VIEWABLE = /\.(3mf|stl)$/i;
const SLICED_EXPORT = /\.gcode\.3mf$/i;
const KB = 1024;

// Static keys so `pnpm i18n:check` sees them; `api()` puts the HTTP status last in the message.
const openError = (t: TFunction, message: string) =>
  message.endsWith(": 409")
    ? t("projects:detail.openFailed.no_slicer")
    : message.endsWith(": 403")
      ? t("projects:detail.openFailed.not_allowed")
      : t("projects:detail.openFailed.launch_failed");

const sizeLabel = (bytes: number) =>
  bytes < KB * KB ? `${Math.round(bytes / KB)} KB` : `${(bytes / KB / KB).toFixed(1)} MB`;

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
    <section aria-labelledby="plates" className="mt-6">
      <h2 id="plates" className="mb-2 text-base font-semibold">
        {t("projects:detail.plates")}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {model.plates.map((p) => (
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
                      {f.grams != null && ` ${formatWeight(f.grams)}`}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What printing a sliced plate would cost, on the default printer (else the first one). */
function Estimate({ plate }: { plate: Plate }) {
  const { t } = useTranslation();
  const ctx = useCostContext().data;
  const defaultId = usePreferences().data?.values.defaultPrinterId;
  if (!ctx) return null;
  const printer = ctx.printers.find((p) => p.id === defaultId) ?? ctx.printers[0];
  return (
    <section aria-labelledby="estimate" className="mt-6 max-w-md">
      <h2 id="estimate" className="mb-1 text-base font-semibold">
        {t("costs:project.title")}
      </h2>
      <p className="mb-2 text-muted">
        {printer
          ? t("costs:project.hint", { printer: printer.name })
          : t("costs:project.hintNoPrinter")}
      </p>
      <div className="rounded-lg border border-border bg-surface p-4">
        <CostBreakdown cost={estimatePlate(plate, printer?.id, ctx)} />
      </div>
    </section>
  );
}

function LinkedPrints({ id }: { id: string }) {
  const { t } = useTranslation();
  const prints = usePrintsOfProject(id).data?.items ?? [];
  return (
    <section aria-labelledby="prints" className="mt-6">
      <h2 id="prints" className="mb-2 text-base font-semibold">
        {t("projects:detail.prints")}
      </h2>
      {prints.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {prints.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <Link to="/prints/$id" params={{ id: p.id }} className="font-medium hover:underline">
                {p.title}
              </Link>
              <span className="text-muted">
                {t(`prints:outcomes.${p.outcome}`)} · {formatDateTime(p.startedAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t("projects:detail.noPrints")}</p>
      )}
      {prints.length > 0 && (
        <div className="mt-3 max-w-md rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-2 font-medium">{t("costs:project.printed")}</h3>
          <CostBreakdown cost={sumCosts(prints.map((p) => p.cost))} />
        </div>
      )}
    </section>
  );
}

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: project, isError } = useProject(id);
  const tags = useTagsOf("project")(id);
  const [picked, setPicked] = useState<string | null>(null);
  const [plate, setPlate] = useState<number | null>(null);
  const open = useOpenProject(id);
  // The default slicer, or the one picked when several are set up (Settings > Integrations).
  const slicers = useCapable("openInSlicer");
  const adapterName = useAdapterName();
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

  // A sliced export the scanner folded into its project file is not a model of its own.
  const models = project.meta.files.filter(
    (f) =>
      f.kind === "model" &&
      !(SLICED_EXPORT.test(f.path) && !project.meta.models.some((m) => m.file === f.path)),
  );
  // Default: the scanner's main file, else the first model.
  const main = models.find((f) => project.filePath?.endsWith(f.path));
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

  return (
    <>
      <PageHeader
        title={project.name}
        backTo={{ to: "/projects" }}
        actions={
          <>
            {project.sourceUrl && (
              <a href={project.sourceUrl} target="_blank" rel="noreferrer" className={linkButton}>
                <ExternalLink className="size-4" aria-hidden />
                {t("projects:detail.source")}
              </a>
            )}
            {project.folderPath && current && slicer && (
              <span className="flex gap-1">
                {slicers.length > 1 && (
                  <select
                    aria-label={t("projects:detail.slicerPick")}
                    className={linkButton}
                    value={slicer.id}
                    onChange={(e) => setSlicerId(e.target.value)}
                  >
                    {slicers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {adapterName(s.adapterId)}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className={linkButton}
                  onClick={() =>
                    open.mutate({ target: "slicer", file: current.path, integrationId: slicer.id })
                  }
                >
                  <Box className="size-4" aria-hidden />
                  {t("projects:detail.openSlicer")}
                </button>
              </span>
            )}
            {project.folderPath && (
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
          </>
        }
      />
      <p role="status" className={open.isError ? "text-bad" : "sr-only"}>
        {open.isError
          ? openError(t, open.error.message)
          : open.isSuccess
            ? t("projects:detail.opened")
            : ""}
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          {current ? (
            <ModelPreview
              projectId={project.id}
              path={current.path}
              url={projectFileUrl(project.id, current.path)}
              ext={current.path.slice(current.path.lastIndexOf(".")).toLowerCase()}
              size={current.size}
              objects={selected?.objects ?? []}
              partColors={info?.partColors ?? []}
              thumbnail={thumbnail}
              name={project.name}
            />
          ) : (
            thumbnail && (
              <img
                src={thumbnail}
                alt={project.name}
                className="w-full rounded-lg border border-border"
              />
            )
          )}
          {models.length > 1 && (
            <label className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-muted">{t("projects:detail.model")}</span>
              <select
                className="h-9 max-w-full rounded-md border border-border bg-surface px-2"
                value={current?.path}
                onChange={(e) => {
                  setPicked(e.target.value);
                  setPlate(null);
                }}
              >
                {models.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                    {VIEWABLE.test(f.path) ? "" : ` (${t("projects:viewer.noPreview")})`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="grid content-start gap-4">
          {project.description && <p className="whitespace-pre-line">{project.description}</p>}
          {tags.length > 0 && <TagList tags={tags} />}
          {(project.meta.materials.length > 0 || project.meta.multicolor) && (
            <p className="text-muted">
              {[
                ...project.meta.materials,
                ...(project.meta.multicolor ? [t("projects:list.multicolor")] : []),
              ].join(" · ")}
            </p>
          )}
          {info && (
            <p className="text-muted">
              {[
                info.slicer && `${info.slicer.name} ${info.slicer.version ?? ""}`.trim(),
                info.printerModel,
                info.nozzleDiameter != null && `${info.nozzleDiameter} mm`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {project.folderPath && <p className="break-all text-muted">{project.folderPath}</p>}
        </div>
      </div>

      {current && <Plates project={project} file={current.path} plate={plate} onPlate={setPlate} />}
      {(selected ?? info?.plates.find((p) => p.sliced)) && (
        <Estimate plate={(selected ?? info?.plates.find((p) => p.sliced)) as Plate} />
      )}
      <LinkedPrints id={id} />

      <section aria-labelledby="files" className="mt-6">
        <h2 id="files" className="mb-2 text-base font-semibold">
          {t("projects:detail.files")}
        </h2>
        {project.meta.files.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {project.meta.files.map((f) => (
              <li key={f.path} className="flex justify-between gap-3 p-2 px-3">
                <span className="break-all">{f.path}</span>
                <span className="shrink-0 text-muted">{sizeLabel(f.size)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("projects:list.noFolder")}</p>
        )}
      </section>
    </>
  );
}
