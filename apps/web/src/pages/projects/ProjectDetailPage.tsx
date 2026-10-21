import { bestMatches, type Project, sumCosts } from "@3d-maker-suite/core";
import { Link, useParams } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Box, ExternalLink, FolderOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { CostBreakdown, UsageBreakdown } from "../../components/CostBreakdown.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagList } from "../../components/TagList.tsx";
import { estimatePlate, estimateSlicedPlates, type Plate, useCostContext } from "../../lib/cost.ts";
import { cx } from "../../lib/cx.ts";
import { spoolName, useProfiles, useSpools } from "../../lib/filament.ts";
import { formatDateTime, formatDuration, formatWeight } from "../../lib/format.ts";
import { useAdapterName, useCapable } from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { printName, usePrintsOfProject } from "../../lib/prints.ts";
import {
  projectFileUrl,
  projectName,
  projectThumbnailUrl,
  useOpenProject,
  useProject,
  useProjectSlicing,
} from "../../lib/projects.ts";
import { useTagsOf } from "../../lib/tags.ts";
import { OrdersTable } from "../orders/OrdersTable.tsx";
import { QuotesTable } from "../quotes/QuotesTable.tsx";
import { ModelPreview } from "./ModelPreview.tsx";
import { ProjectFiles } from "./ProjectFiles.tsx";

const linkButton =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2";
const VIEWABLE = /\.(3mf|stl)$/i;
const SLICED_EXPORT = /\.gcode\.3mf$/i;

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
    <section aria-labelledby="plates" className="mt-6">
      <h2 id="plates" className="mb-2 text-base font-semibold">
        {t("projects:detail.plates")}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
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
                {printName(t, p)}
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
    </section>
  );
}

/** One print of the whole project, from its sliced plates, on the default printer. */
function SlicedEstimate({ id }: { id: string }) {
  const { t } = useTranslation();
  const plates = useProjectSlicing(id).data?.plates ?? [];
  const ctx = useCostContext().data;
  const defaultId = usePreferences().data?.values.defaultPrinterId;
  const profiles = useProfiles().data?.items ?? [];
  const spools = useSpools().data?.items ?? [];
  const sliced = plates.filter((p) => p.result).length;
  if (!ctx || !sliced) return null;
  const fallback = ctx.printers.find((p) => p.id === defaultId) ?? ctx.printers[0];
  const used = new Set(plates.filter((p) => p.result).map((p) => p.printerId ?? fallback?.id));
  const printer = used.size === 1 ? ctx.printers.find((p) => used.has(p.id)) : undefined;
  const estimate = estimateSlicedPlates(plates, ctx, {
    spools,
    profiles,
    fallbackPrinterId: fallback?.id,
  });
  const profileOf = (id: string) => profiles.find((p) => p.id === id);
  return (
    <div className="max-w-md rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 font-medium">{t("costs:project.onePrint")}</h3>
      <p className="mb-2 text-muted">
        {printer
          ? t("costs:project.onePrintHint", { printer: printer.name })
          : used.size > 1
            ? t("costs:project.onePrintHintPrinters")
            : t("costs:project.onePrintHintNoPrinter")}
      </p>
      {sliced < plates.length && (
        <p className="mb-2 text-warn">
          {t("costs:project.partial", { sliced, total: plates.length })}
        </p>
      )}
      <div className="grid gap-3">
        <UsageBreakdown
          spools={estimate.spools.map(({ spool, grams }) => ({
            label: spoolName(t, spool, profileOf(spool.profileId)),
            grams,
          }))}
          materials={estimate.materials}
        />
        <CostBreakdown cost={estimate.cost} />
      </div>
    </div>
  );
}

function PrintedCost({ id }: { id: string }) {
  const { t } = useTranslation();
  const prints = usePrintsOfProject(id).data?.items ?? [];
  if (!prints.length) return null;
  return (
    <div className="max-w-md rounded-lg border border-border bg-surface p-4">
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
  // undefined: not picked yet (a file with several plates opens on its first); null: whole file.
  const [pickedPlate, setPlate] = useState<number | null>();
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
  const main = models.find((f) => project.filePath?.replaceAll("\\", "/").endsWith(`/${f.path}`));
  const current = models.find((f) => f.path === picked) ?? main ?? models[0];
  const info = project.meta.models.find((m) => m.file === current?.path);
  const plate =
    pickedPlate !== undefined
      ? pickedPlate
      : info && info.plates.length > 1
        ? (info.plates[0]?.index ?? null)
        : null;
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
            {project.folderPath && current && slicer && (
              <span className="flex gap-1">
                {slicers.length > 1 && (
                  <Combobox
                    aria-label={t("projects:detail.slicerPick")}
                    className={linkButton}
                    value={slicer.id}
                    onChange={setSlicerId}
                    options={slicers.map((s) => ({ value: s.id, label: adapterName(s.adapterId) }))}
                  />
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
        <div className="min-w-0">
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
          {models.length > 1 && (
            <label className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-muted">{t("projects:detail.model")}</span>
              <Combobox
                className="h-9 max-w-full rounded-md border border-border bg-surface px-2"
                value={current?.path ?? ""}
                onChange={(v) => {
                  setPicked(v);
                  setPlate(undefined);
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
        <div className="grid min-w-0 content-start gap-4 [&>section]:mt-0">
          <SlicedEstimate id={id} />
          <PrintedCost id={id} />
          {/* Only plates the 3MF has slice data for; the app's own slices are in SlicedEstimate. */}
          {((selected?.sliced && selected) || info?.plates.find((p) => p.sliced)) && (
            <Estimate
              plate={
                ((selected?.sliced && selected) || info?.plates.find((p) => p.sliced)) as Plate
              }
            />
          )}
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
      {project.meta.models.length > 0 && (
        <p className="mt-4">
          <Link to="/projects/$id/edit" params={{ id }} hash="slicing" className={linkButton}>
            {t("projects:detail.setUpSlicing")}
          </Link>
        </p>
      )}
      {project.description && (
        <section aria-labelledby="description" className="mt-6">
          <h2 id="description" className="mb-2 text-base font-semibold">
            {t("projects:detail.description")}
          </h2>
          <div className="rounded-lg border border-border bg-surface p-4">
            {project.descriptionFile?.toLowerCase().endsWith(".txt") ? (
              <p className="whitespace-pre-line">{project.description}</p>
            ) : (
              <Markdown>{project.description}</Markdown>
            )}
          </div>
        </section>
      )}

      <LinkedPrints id={id} />
      <QuotesTable fixed={{ projectId: id }} title={t("costs:saved.title")} />
      <OrdersTable fixed={{ projectId: id }} title={t("orders:list.table")} />

      <ProjectFiles project={project} />
    </>
  );
}
