import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button.tsx";

// Native <dialog> holding a form: focus trap, Escape, and focus return on close come from the browser.
// Children mount only while open, so uncontrolled fields start fresh each time.
export function FormDialog({
  open,
  title,
  error,
  busy,
  onSubmit,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  error?: string;
  busy?: boolean;
  onSubmit: (f: FormData) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d || open === d.open) return;
    if (open) d.showModal();
    else d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,26rem)] rounded-lg border border-border bg-surface p-5 text-fg"
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
          className="grid gap-4"
        >
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {children}
          {error && (
            <p role="alert" className="text-bad">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {t("printers:form.save")}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
