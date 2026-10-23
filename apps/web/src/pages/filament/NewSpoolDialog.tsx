import type { Spool } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { useProfiles } from "../../lib/filament.ts";
import { SpoolForm } from "./SpoolFormPage.tsx";

/**
 * Modal: add a spool without leaving the page (a review picking spools). `open` starts it from
 * what the slot says: a colour, a filament (a profile name, else a material and maybe a colour)
 * and the day it was open by; null closes it.
 */
export function NewSpoolDialog({
  open,
  onClose,
  onSaved,
}: {
  open: { colorHex?: string; filament?: string; openedAt?: string } | null;
  onClose: () => void;
  onSaved: (spool: Spool) => void;
}) {
  const { t } = useTranslation();
  const profiles = useProfiles().data?.items ?? [];
  const said = open?.filament?.trim().toLowerCase();
  // "PLA #ff8800": the material without the colour.
  const material = said?.replace(/#[0-9a-f]{6}\b/i, "").trim();
  const profile = said
    ? (profiles.find((p) => p.name.toLowerCase() === said) ??
      profiles.find((p) => p.material.toLowerCase() === material) ??
      profiles.find((p) => said.startsWith(p.material.toLowerCase())))
    : undefined;
  return (
    <AddDialog open={!!open} title={t("filament:spools.addTitle")} onClose={onClose}>
      {open && (
        <SpoolForm
          profiles={profiles}
          colorHex={open.colorHex}
          profileId={profile?.id}
          openedAt={open.openedAt}
          onCancel={onClose}
          onSaved={(s) => {
            onSaved(s);
            onClose();
          }}
        />
      )}
    </AddDialog>
  );
}
