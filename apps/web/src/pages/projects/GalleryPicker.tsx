import type { Project, ProjectFile } from "@3d-maker-suite/core";
import { Eye, Plus, Star, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { ImageViewer } from "../../components/ImageViewer.tsx";
import { SearchPicker } from "../../components/SearchPicker.tsx";
import { cx } from "../../lib/cx.ts";
import { projectImageUrl } from "../../lib/projects.ts";

const parentsOf = (path: string) => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};
const tileButton =
  "inline-flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80";

type Tile = { path: string };

/**
 * Gallery images and cover. "Selected images" is the gallery itself (cover star, remove); below it
 * the project's other images to browse, all or only from chosen folders, and add. The eye opens
 * the full-screen viewer in both lists.
 */
export function GalleryPicker({
  project,
  images,
  value,
  cover,
  onChange,
  onCover,
}: {
  project: Project;
  /** The images it can pick from. */
  images: ProjectFile[];
  /** The gallery's image paths, in the order they were added. */
  value: string[];
  cover: string;
  onChange: (images: string[]) => void;
  onCover: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [fromFolders, setFromFolders] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [viewing, setViewing] = useState<{ list: "selected" | "available"; i: number } | null>(
    null,
  );
  const folderOptions = [...new Set(images.flatMap((f) => parentsOf(f.path)))]
    .sort()
    .map((d) => ({ id: d, label: d }));
  // The project folder itself ("") is every image; the others cover what is below them.
  const inFolders = (path: string) => folders.some((d) => path.startsWith(`${d}/`));
  const needle = query.trim().toLowerCase();

  const selected: Tile[] = value.flatMap((p) => images.find((f) => f.path === p) ?? []);
  const available: Tile[] = images.filter(
    (f) =>
      !value.includes(f.path) &&
      (!fromFolders || inFolders(f.path)) &&
      f.path.toLowerCase().includes(needle),
  );
  const url = (path: string) => projectImageUrl(project.id, path);
  const lists = { selected, available };

  const grid = (list: "selected" | "available") => (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {lists[list].map((f, i) => (
        <li key={f.path} className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="relative aspect-square bg-surface-2">
            <img src={url(f.path)} alt="" loading="lazy" className="size-full object-contain" />
            <button
              type="button"
              onClick={() => setViewing({ list, i })}
              aria-label={t("projects:form.galleryPreview", { name: f.path })}
              className={cx(tileButton, "absolute bottom-1.5 right-1.5")}
            >
              <Eye className="size-4" aria-hidden />
            </button>
            {list === "selected" ? (
              <>
                <button
                  type="button"
                  aria-pressed={cover === f.path}
                  onClick={() => onCover(cover === f.path ? "" : f.path)}
                  aria-label={t("projects:form.coverSet", { name: f.path })}
                  className={cx(tileButton, "absolute left-1.5 top-1.5")}
                >
                  <Star
                    className={cx("size-4", cover === f.path && "fill-yellow-400 text-yellow-400")}
                    aria-hidden
                  />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange(value.filter((p) => p !== f.path));
                    if (cover === f.path) onCover("");
                  }}
                  aria-label={t("projects:form.galleryRemove", { name: f.path })}
                  className={cx(tileButton, "absolute right-1.5 top-1.5")}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onChange([...value, f.path])}
                aria-label={t("projects:form.galleryAdd", { name: f.path })}
                className={cx(tileButton, "absolute right-1.5 top-1.5")}
              >
                <Plus className="size-4" aria-hidden />
              </button>
            )}
          </div>
          <p className="break-all px-2 py-1.5 text-xs">{f.path}</p>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="grid min-w-0 gap-4 sm:max-w-none!">
      <div>
        <h2 className="mb-1 font-medium">{t("projects:form.gallery")}</h2>
        <p className="text-muted">{t("projects:form.galleryHint")}</p>
      </div>
      <section aria-labelledby="gallery-selected" className="grid gap-2">
        <h3 id="gallery-selected" className="font-medium">
          {t("projects:form.gallerySelected", { count: selected.length })}
        </h3>
        <p className="text-muted">
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
        {selected.length ? (
          grid("selected")
        ) : (
          <p className="text-muted">{t("projects:form.galleryEmpty")}</p>
        )}
      </section>

      <section aria-labelledby="gallery-available" className="grid gap-3">
        <h3 id="gallery-available" className="font-medium">
          {t("projects:form.galleryAvailable", { count: available.length })}
        </h3>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">{t("projects:form.galleryView")}</legend>
          {[false, true].map((on) => (
            <label key={String(on)} className="flex min-h-9 items-center gap-2">
              <input
                type="radio"
                name="gallery-view"
                checked={fromFolders === on}
                onChange={() => setFromFolders(on)}
              />
              {t(on ? "projects:form.galleryViewFolders" : "projects:form.galleryViewAll")}
            </label>
          ))}
        </fieldset>
        {fromFolders && (
          <div className="max-w-md">
            <SearchPicker
              browse
              label={t("projects:form.galleryFolders")}
              options={folderOptions}
              value={folders}
              onChange={setFolders}
            />
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
          <Button
            onClick={() => onChange([...value, ...available.map((f) => f.path)])}
            disabled={!available.length}
          >
            {t("projects:form.galleryAddShown")}
          </Button>
        </div>
        {available.length ? (
          grid("available")
        ) : (
          <p className="text-muted">
            {t(
              fromFolders && !folders.length
                ? "projects:form.galleryPickFolder"
                : "projects:form.galleryNone",
            )}
          </p>
        )}
      </section>

      {viewing && (
        <ImageViewer
          images={lists[viewing.list].map((f) => ({ src: url(f.path), label: f.path }))}
          index={viewing.i}
          onIndex={(i) => setViewing({ ...viewing, i })}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
