import type { Project } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { projectImageUrl } from "../../lib/projects.ts";

type Gallery = Project["gallery"];

const parentsOf = (path: string) => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

/** Gallery picks from the scanned images: whole folders (and below) and/or single images. */
export function GalleryPicker({
  project,
  value,
  onChange,
}: {
  project: Project;
  value: Gallery;
  onChange: (g: Gallery) => void;
}) {
  const { t } = useTranslation();
  const images = project.meta.files.filter((f) => f.kind === "image");
  const folders = ["", ...new Set(images.flatMap((f) => parentsOf(f.path)))].sort();
  const inFolder = (path: string) =>
    value.folders.some((d) => d === "" || path.startsWith(`${d}/`));
  const toggle = (list: string[], item: string, on: boolean) =>
    on ? [...list, item] : list.filter((x) => x !== item);

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-medium">{t("projects:form.gallery")}</legend>
      <p className="text-muted">{t("projects:form.galleryHint")}</p>
      <p className="mt-2 font-medium">{t("projects:form.galleryFolders")}</p>
      {folders.map((d) => (
        <label key={d} className="flex min-h-8 items-center gap-2">
          <input
            type="checkbox"
            checked={value.folders.includes(d)}
            onChange={(e) =>
              onChange({ ...value, folders: toggle(value.folders, d, e.target.checked) })
            }
          />
          {d || t("projects:form.galleryProjectFolder")}
        </label>
      ))}
      <p className="mt-2 font-medium">{t("projects:form.galleryImages")}</p>
      <ul className="flex flex-col gap-1">
        {images.map((f) => {
          const covered = inFolder(f.path);
          return (
            <li key={f.path}>
              <label className="flex min-h-10 items-center gap-2">
                <input
                  type="checkbox"
                  checked={covered || value.images.includes(f.path)}
                  disabled={covered}
                  onChange={(e) =>
                    onChange({ ...value, images: toggle(value.images, f.path, e.target.checked) })
                  }
                />
                <img
                  src={projectImageUrl(project.id, f.path)}
                  alt=""
                  loading="lazy"
                  className="size-10 rounded border border-border object-contain"
                />
                <span className="break-all">{f.path}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
