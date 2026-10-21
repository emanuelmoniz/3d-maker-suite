import type { Project } from "@3d-maker-suite/core";
import { Eye, Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { ImageViewer } from "../../components/ImageViewer.tsx";
import { cx } from "../../lib/cx.ts";
import { inGalleryFolder, projectImageUrl } from "../../lib/projects.ts";

type Gallery = Project["gallery"];

const parentsOf = (path: string) => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};
const toggle = (list: string[], item: string, on: boolean) =>
  on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);
const tileButton =
  "inline-flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80";

/**
 * Gallery picks and cover from the scanned images: search, whole folders (and below) and/or single
 * images on a thumbnail grid; the eye opens the full-screen viewer, the star marks the cover.
 */
export function GalleryPicker({
  project,
  value,
  cover,
  onChange,
  onCover,
}: {
  project: Project;
  value: Gallery;
  cover: string;
  onChange: (g: Gallery) => void;
  onCover: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const images = project.meta.files.filter((f) => f.kind === "image");
  const folders = ["", ...new Set(images.flatMap((f) => parentsOf(f.path)))].sort();
  const shown = images.filter((f) => f.path.toLowerCase().includes(query.trim().toLowerCase()));
  const covered = (path: string) => inGalleryFolder(value, path);
  const picked = (path: string) => covered(path) || value.images.includes(path);
  const count = images.filter((f) => picked(f.path)).length;
  const setShown = (on: boolean) =>
    onChange({
      ...value,
      images: shown
        .filter((f) => !covered(f.path))
        .reduce((list, f) => toggle(list, f.path, on), value.images),
    });

  return (
    <fieldset className="grid min-w-0 gap-3 sm:max-w-none!">
      <legend className="mb-1.5 font-medium">{t("projects:form.gallery")}</legend>
      <p className="text-muted">{t("projects:form.galleryHint")}</p>

      {folders.length > 1 && (
        <div className="grid gap-1.5">
          <p className="font-medium">{t("projects:form.galleryFolders")}</p>
          <div className="flex flex-wrap gap-2">
            {folders.map((d) => {
              const on = value.folders.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...value, folders: toggle(value.folders, d, !on) })}
                  className={cx(
                    "min-h-9 max-w-full break-all rounded-full border px-3 text-left",
                    on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface",
                  )}
                >
                  {d || t("projects:form.galleryProjectFolder")}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label={t("projects:form.gallerySearch")}
          placeholder={t("projects:form.gallerySearch")}
          className={cx(inputClass, "min-w-0 flex-1 sm:max-w-xs")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
        <Button onClick={() => setShown(true)} disabled={!shown.length}>
          {t("projects:form.galleryAddShown")}
        </Button>
        <Button onClick={() => setShown(false)} disabled={!shown.length}>
          {t("projects:form.galleryRemoveShown")}
        </Button>
      </div>
      <p role="status" className="text-muted">
        {t("projects:form.galleryCount", { picked: count, total: images.length })}
        {" · "}
        {cover ? t("projects:form.coverIs", { name: cover }) : t("projects:form.coverAuto")}
        {cover && (
          <>
            {" "}
            <button type="button" className="underline" onClick={() => onCover("")}>
              {t("projects:form.coverClear")}
            </button>
          </>
        )}
      </p>

      {shown.length ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {shown.map((f, i) => (
            <li
              key={f.path}
              className={cx(
                "overflow-hidden rounded-lg border bg-surface",
                picked(f.path) ? "border-accent" : "border-border",
              )}
            >
              <div className="relative aspect-square bg-surface-2">
                <img
                  src={projectImageUrl(project.id, f.path)}
                  alt=""
                  loading="lazy"
                  className="size-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => setViewing(i)}
                  aria-label={t("projects:form.galleryPreview", { name: f.path })}
                  className={cx(tileButton, "absolute bottom-1.5 right-1.5")}
                >
                  <Eye className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-pressed={cover === f.path}
                  onClick={() => onCover(cover === f.path ? "" : f.path)}
                  aria-label={t("projects:form.coverSet", { name: f.path })}
                  className={cx(tileButton, "absolute right-1.5 top-1.5")}
                >
                  <Star
                    className={cx("size-4", cover === f.path && "fill-yellow-400 text-yellow-400")}
                    aria-hidden
                  />
                </button>
              </div>
              <label className="flex min-h-11 items-center gap-2 px-2 py-1.5">
                <input
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={picked(f.path)}
                  disabled={covered(f.path)}
                  onChange={(e) =>
                    onChange({ ...value, images: toggle(value.images, f.path, e.target.checked) })
                  }
                />
                <span className="min-w-0 break-all text-xs">{f.path}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t("projects:form.galleryNone")}</p>
      )}

      {viewing !== null && (
        <ImageViewer
          images={shown.map((f) => ({ src: projectImageUrl(project.id, f.path), label: f.path }))}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </fieldset>
  );
}
