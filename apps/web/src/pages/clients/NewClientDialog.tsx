import type { Client } from "@3d-maker-suite/core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ClientForm } from "./ClientFormPage.tsx";

/** Modal: add a client without leaving the page (the costs page). Native <dialog> like ConfirmDialog. */
export function NewClientDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (client: Client) => void;
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
      aria-labelledby="new-client-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[90vh] w-[min(92vw,30rem)] overflow-y-auto rounded-lg border border-border bg-surface p-5 text-fg"
    >
      {open && (
        <>
          <h2 id="new-client-title" className="mb-4 text-base font-semibold">
            {t("clients:form.addTitle")}
          </h2>
          <ClientForm
            onCancel={onClose}
            onSaved={(c) => {
              onSaved(c);
              onClose();
            }}
          />
        </>
      )}
    </dialog>
  );
}
