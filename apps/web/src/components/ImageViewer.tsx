import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export type ViewerImage = { src: string; label: string };

const MIN = 1;
const MAX = 8;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));
const iconButton =
  "inline-flex size-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-40";

/**
 * Full-screen image viewer on a native `<dialog>` (focus trap, Escape). Zoom: wheel, pinch, + / -
 * keys or buttons; pan: drag or touch while zoomed; arrow keys or buttons for next / previous.
 * Mount it only while open.
 */
export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: ViewerImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const image = images[index];

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => setView({ scale: 1, x: 0, y: 0 }), [index]);

  const zoom = (factor: number) =>
    setView((v) => {
      const scale = clamp(v.scale * factor);
      return scale === MIN ? { scale, x: 0, y: 0 } : { ...v, scale };
    });

  // React's wheel listener is passive: a native one is needed to stop the page scrolling behind.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const go = (step: number) => onIndex((index + step + images.length) % images.length);
  const reset = () => setView({ scale: 1, x: 0, y: 0 });

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pointers.current.values()];
    if (a && b) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) zoom(d / pinch.current);
      pinch.current = d;
    } else {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setView((v) => (v.scale > MIN ? { ...v, x: v.x + dx, y: v.y + dy } : v));
    }
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = 0;
  };

  return (
    <dialog
      ref={dialog}
      aria-label={image?.label}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        else if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "+" || e.key === "=") zoom(1.25);
        else if (e.key === "-") zoom(0.8);
        else if (e.key === "0") reset();
      }}
      className="m-0 size-full max-h-none max-w-none bg-black p-0 text-white backdrop:bg-black"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer zoom/pan; every action also has a button and a key */}
      <div
        ref={stage}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={() => (view.scale > MIN ? reset() : zoom(2.5))}
        className="absolute inset-0 flex touch-none select-none items-center justify-center overflow-hidden"
        style={{ cursor: view.scale > MIN ? "grab" : "zoom-in" }}
      >
        {image && (
          <img
            src={image.src}
            alt={image.label}
            draggable={false}
            className="max-h-full max-w-full object-contain"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          />
        )}
      </div>

      <p className="pointer-events-none absolute inset-x-0 top-0 truncate bg-gradient-to-b from-black/70 to-transparent px-4 pb-6 pt-3 pr-16">
        <span className="font-medium">{image?.label}</span>{" "}
        <span className="text-white/70">
          {t("common:viewer.position", { index: index + 1, count: images.length })}
        </span>
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common:viewer.close")}
        className={`${iconButton} absolute right-3 top-3`}
      >
        <X className="size-5" aria-hidden />
      </button>
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t("common:viewer.previous")}
            className={`${iconButton} absolute left-3 top-1/2 -translate-y-1/2`}
          >
            <ChevronLeft className="size-6" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t("common:viewer.next")}
            className={`${iconButton} absolute right-3 top-1/2 -translate-y-1/2`}
          >
            <ChevronRight className="size-6" aria-hidden />
          </button>
        </>
      )}
      <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => zoom(0.8)}
          disabled={view.scale <= MIN}
          aria-label={t("common:viewer.zoomOut")}
          className={iconButton}
        >
          <Minus className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={view.scale === MIN}
          aria-label={t("common:viewer.reset")}
          className={iconButton}
        >
          <RotateCcw className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => zoom(1.25)}
          disabled={view.scale >= MAX}
          aria-label={t("common:viewer.zoomIn")}
          className={iconButton}
        >
          <Plus className="size-5" aria-hidden />
        </button>
      </div>
    </dialog>
  );
}
