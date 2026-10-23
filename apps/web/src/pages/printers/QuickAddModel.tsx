import type { PrinterModel } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormDialog } from "../../components/FormDialog.tsx";
import { isConflict, useSaveCatalog } from "../../lib/catalog.ts";
import { BrandFields, brandBody, ModelFields, modelBody } from "./CatalogForms.tsx";

/** "Add model" modal for the printer form; its "Add brand" opens a second modal on top. */
export function QuickAddModel({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (m: PrinterModel) => void;
}) {
  const { t } = useTranslation();
  const [brandOpen, setBrandOpen] = useState(false);
  const [brandId, setBrandId] = useState<string>();
  const saveModel = useSaveCatalog("printer-models");
  const saveBrand = useSaveCatalog("brands");
  const err = (e: unknown) =>
    e ? t(isConflict(e) ? "printers:catalog.duplicate" : "printers:catalog.error") : undefined;

  return (
    <>
      <FormDialog
        open={open}
        title={t("printers:catalog.models.addTitle")}
        error={err(saveModel.error)}
        busy={saveModel.isPending}
        onCancel={onClose}
        onSubmit={(f) => saveModel.mutate(modelBody(f), { onSuccess: onSaved })}
      >
        <ModelFields brandId={brandId} onAddBrand={() => setBrandOpen(true)} />
      </FormDialog>
      <FormDialog
        open={brandOpen}
        title={t("printers:catalog.brands.addTitle")}
        error={err(saveBrand.error)}
        busy={saveBrand.isPending}
        onCancel={() => setBrandOpen(false)}
        onSubmit={(f) =>
          saveBrand.mutate(brandBody(f), {
            onSuccess: (b) => {
              setBrandId(b.id);
              setBrandOpen(false);
            },
          })
        }
      >
        <BrandFields />
      </FormDialog>
    </>
  );
}
