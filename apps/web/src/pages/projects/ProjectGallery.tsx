import type { Project } from "@3d-maker-suite/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageViewer } from "../../components/ImageViewer.tsx";
import { galleryImages, projectImageUrl } from "../../lib/projects.ts";

const SWIPE = 40;
const arrow =
  "absolute top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75 focus-visible:bg-black/75";

/** The project's pictures: a square viewer with arrows and swipe, thumbnails below. A click opens the full-screen viewer. */
export function ProjectGallery({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const swipe = useRef<{ x: number; moved: boolean } | null>(null);
  const strip = useRef<HTMLUListElement>(null);
  const images = galleryImages(project).map((f) => ({
    src: projectImageUrl(project.id, f.path),
    label: f.path,
  }));
  const count = images.length;
  const current = images[Math.min(index, count - 1)];

  const go = (step: number) => setIndex((i) => (i + step + count) % count);
  // Keep the picked thumbnail in view.
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);

  if (!current) return null;
  return (
    <section aria-label={t("projects:detail.gallery", { count })} className="grid gap-2">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only relays arrow keys from the buttons inside; each has its own button */}
      <div
        className="relative"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          else if (e.key === "ArrowLeft") go(-1);
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (!swipe.current?.moved) setOpen(index);
          }}
          onPointerDown={(e) => {
            swipe.current = { x: e.clientX, moved: false };
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            if (s && Math.abs(e.clientX - s.x) > SWIPE) {
              s.moved = true;
              go(e.clientX < s.x ? 1 : -1);
            }
          }}
          aria-label={t("projects:detail.galleryOpen", { name: current.label })}
          className="block aspect-square w-full touch-pan-y overflow-hidden rounded-lg border border-border bg-surface-2 hover:border-accent"
        >
          <img
            src={current.src}
            alt=""
            draggable={false}
            className="size-full select-none object-cover"
          />
        </button>
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t("common:viewer.previous")}
              className={`${arrow} left-2`}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t("common:viewer.next")}
              className={`${arrow} right-2`}
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
            <p
              aria-live="polite"
              className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-white"
            >
              {t("common:viewer.position", { index: index + 1, count })}
            </p>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => strip.current?.scrollBy({ left: -240, behavior: "smooth" })}
            aria-label={t("projects:detail.galleryScrollBack")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-2"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <ul ref={strip} className="flex min-w-0 snap-x gap-2 overflow-x-auto p-1">
            {images.map((img, i) => (
              <li key={img.label} className="snap-start">
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={t("projects:detail.galleryShow", { name: img.label })}
                  aria-current={i === index}
                  className={`block size-16 overflow-hidden rounded-md border-2 bg-surface-2 ${
                    i === index ? "border-accent" : "border-border opacity-80 hover:opacity-100"
                  }`}
                >
                  <img
                    src={img.src}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="size-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => strip.current?.scrollBy({ left: 240, behavior: "smooth" })}
            aria-label={t("projects:detail.galleryScrollForward")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-2"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      )}
      {open !== null && (
        <ImageViewer
          images={images}
          index={open}
          onIndex={(i) => {
            setOpen(i);
            setIndex(i);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
