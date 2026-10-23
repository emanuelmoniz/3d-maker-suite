import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * The modal behind every "add from a picker" button: native <dialog> (focus trap, Escape, focus
 * return), closed by a backdrop click. Portalled to <body>, so it can sit inside a page form or
 * another AddDialog; children mount only while open, so their fields start fresh.
 */
export function AddDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d || open === d.open) return;
    if (open) d.showModal();
    else d.close();
  }, [open]);
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      // React events bubble through portals: keep this form's submit out of the form it sits in.
      onSubmit={(e) => e.stopPropagation()}
      className="m-auto max-h-[90vh] w-[min(92vw,30rem)] overflow-y-auto rounded-lg border border-border bg-surface p-5 text-fg"
    >
      {open && (
        <>
          <h2 id={titleId} className="mb-4 text-base font-semibold">
            {title}
          </h2>
          {children}
        </>
      )}
    </dialog>,
    document.body,
  );
}
