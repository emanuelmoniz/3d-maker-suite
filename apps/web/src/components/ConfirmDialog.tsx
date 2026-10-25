import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button.tsx";

// Native <dialog>: focus trap, Escape and backdrop come from the browser.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra fields (e.g. a date) between the description and the buttons. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || open === d.open) return;
    if (open) d.showModal();
    else d.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => e.target === ref.current && onCancel()}
      className="m-auto w-[min(92vw,26rem)] rounded-lg border border-border bg-surface p-5 text-fg"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 whitespace-pre-line text-muted">{description}</p>
      {children && <div className="mt-4 grid gap-3">{children}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
        <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel ?? t("common:actions.confirm")}
        </Button>
      </div>
    </dialog>
  );
}
