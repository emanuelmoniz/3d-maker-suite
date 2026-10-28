import type { ProjectDetail } from "@3d-maker-suite/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageViewer } from "../../components/ImageViewer.tsx";
import { galleryImages, projectImageUrl } from "../../lib/projects.ts";

const SWIPE = 40;
const thumbArrow =
  "absolute top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:bg-black/80";
const arrow =
  "absolute top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75 focus-visible:bg-black/75";

/**
 * The project's pictures: a square viewer with arrows and swipe, thumbnails below. A click opens
 * the full-screen viewer. Picks its device didn't send (over the folder's caps) are left out.
 */
export function ProjectGallery({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const swipe = useRef<{ x: number; moved: boolean } | null>(null);
  const strip = useRef<HTMLUListElement>(null);
  const [overflow, setOverflow] = useState(false);
  // The cover first, then the most recently changed.
  const leftOut = project.galleryLeftOut.length;
  const ordered = galleryImages(project)
    .filter((f) => !project.galleryLeftOut.includes(f.path))
    .sort(
      (a, b) =>
        Number(b.path === project.coverFile) - Number(a.path === project.coverFile) ||
        (b.mtime ?? 0) - (a.mtime ?? 0),
    );
  const images = ordered.map((f) => ({
    src: projectImageUrl(project.id, f.path),
    label: f.path,
  }));
  const count = images.length;
  const current = images[Math.min(index, count - 1)];

  const go = (step: number) => setIndex((i) => (i + step + count) % count);
  // Scroll buttons only when the thumbnails do not all fit.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);
  // Keep the picked thumbnail in view.
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);

  const note = leftOut > 0 && (
    <p className="text-muted">{t("projects:detail.galleryLeftOut", { count: leftOut })}</p>
  );
  if (!current) return note || null;
  return (
    <section
      aria-label={t("projects:detail.gallery", { count })}
      className="grid min-w-0 gap-2 lg:order-last"
    >
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
        <div className="relative">
          <ul
            ref={strip}
            className="flex snap-x gap-2 overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
          >
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
          {overflow && (
            <>
              <button
                type="button"
                onClick={() => strip.current?.scrollBy({ left: -240, behavior: "smooth" })}
                aria-label={t("projects:detail.galleryScrollBack")}
                className={`${thumbArrow} left-1`}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => strip.current?.scrollBy({ left: 240, behavior: "smooth" })}
                aria-label={t("projects:detail.galleryScrollForward")}
                className={`${thumbArrow} right-1`}
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </>
          )}
        </div>
      )}
      {note}
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
