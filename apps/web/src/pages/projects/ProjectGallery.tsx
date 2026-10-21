import type { Project } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible } from "../../components/Collapsible.tsx";
import { ImageViewer } from "../../components/ImageViewer.tsx";
import { galleryImages, projectImageUrl } from "../../lib/projects.ts";

/** The images the user picked for the project; a click opens the full-screen viewer. */
export function ProjectGallery({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const images = galleryImages(project).map((f) => ({
    src: projectImageUrl(project.id, f.path),
    label: f.path,
  }));
  if (!images.length) return null;
  return (
    <Collapsible title={t("projects:detail.gallery", { count: images.length })}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {images.map((img, i) => (
          <li key={img.label}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={t("projects:detail.galleryOpen", { name: img.label })}
              className="block aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface-2 hover:border-accent"
            >
              <img src={img.src} alt="" loading="lazy" className="size-full object-contain" />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && (
        <ImageViewer images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </Collapsible>
  );
}
