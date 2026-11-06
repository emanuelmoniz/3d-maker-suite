import type { Spool } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { useFilamentMaterials } from "../../lib/catalog.ts";
import { SpoolForm } from "./SpoolFormPage.tsx";

/**
 * Modal: add a spool without leaving the page (a review picking spools). `open` starts it from
 * what the slot says: a colour, a filament (a material and maybe a colour) and the day it was
 * open by; null closes it.
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
  const materials = useFilamentMaterials().data;
  // "PLA #ff8800": the material without the colour.
  const said = open?.filament
    ?.replace(/#[0-9a-f]{6}\b/i, "")
    .trim()
    .toLowerCase();
  const material = said
    ? (materials?.find((m) => m.name.toLowerCase() === said) ??
      materials?.find((m) => said.startsWith(m.name.toLowerCase())))
    : undefined;
  return (
    <AddDialog open={!!open} title={t("filament:spools.addTitle")} onClose={onClose}>
      {/* Once the materials are in, so the form starts on the one the slot names. */}
      {open && materials && (
        <SpoolForm
          colorHex={open.colorHex}
          materialId={material?.id}
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
