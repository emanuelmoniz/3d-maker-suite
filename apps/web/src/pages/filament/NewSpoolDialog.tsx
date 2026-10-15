import type { Spool } from "@3d-maker-suite/core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useProfiles } from "../../lib/filament.ts";
import { SpoolForm } from "./SpoolFormPage.tsx";

/**
 * Modal: add a spool without leaving the page (a review picking spools). `open` starts it from
 * what the slot says: a colour, and a filament (a profile name, else a material); null closes it.
 * Native <dialog> like ConfirmDialog.
 */
export function NewSpoolDialog({
  open,
  onClose,
  onSaved,
}: {
  open: { colorHex?: string; filament?: string } | null;
  onClose: () => void;
  onSaved: (spool: Spool) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const profiles = useProfiles().data?.items ?? [];
  const said = open?.filament?.trim().toLowerCase();
  const profile = said
    ? (profiles.find((p) => p.name.toLowerCase() === said) ??
      profiles.find((p) => said.startsWith(p.material.toLowerCase())))
    : undefined;
  useEffect(() => {
    const d = ref.current;
    if (!d || !!open === d.open) return;
    if (open) d.showModal();
    else d.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively
    <dialog
      ref={ref}
      aria-labelledby="new-spool-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[90vh] w-[min(92vw,30rem)] overflow-y-auto rounded-lg border border-border bg-surface p-5 text-fg"
    >
      {open && (
        <>
          <h2 id="new-spool-title" className="mb-4 text-base font-semibold">
            {t("filament:spools.addTitle")}
          </h2>
          <SpoolForm
            profiles={profiles}
            colorHex={open.colorHex}
            profileId={profile?.id}
            onCancel={onClose}
            onSaved={(s) => {
              onSaved(s);
              onClose();
            }}
          />
        </>
      )}
    </dialog>
  );
}
