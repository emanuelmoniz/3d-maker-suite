import type { FilamentBrand, FilamentMaterial } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField } from "../../components/FormField.tsx";
import { PickerWithAdd } from "../../components/PickerWithAdd.tsx";
import { useFilamentBrands, useFilamentMaterials } from "../../lib/catalog.ts";
import { BrandFields, brandBody, CatalogAddDialog } from "../printers/CatalogForms.tsx";
import { MaterialFields, materialBody } from "./CatalogForms.tsx";

type Kind = "filament-brands" | "filament-materials";
type Row = FilamentBrand | FilamentMaterial;

/** A brand / material picker with "+ Add …" (a modal), for the filament profile form. */
export function CatalogSelect<K extends Kind>(props: {
  kind: K;
  name: string;
  label: string;
  addLabel: string;
  required?: boolean;
  defaultValue?: string | null;
  /** Called with the picked (or just added) row, or undefined for "none". */
  onPick?: (row: Row | undefined) => void;
}) {
  const { t } = useTranslation();
  const brands = useFilamentBrands();
  const materials = useFilamentMaterials();
  const isBrand = props.kind === "filament-brands";
  const rows: Row[] = (isBrand ? brands.data : materials.data) ?? [];
  const [value, setValue] = useState(props.defaultValue ?? "");
  const [adding, setAdding] = useState(false);

  const pick = (id: string, row = rows.find((r) => r.id === id)) => {
    setValue(id);
    props.onPick?.(row);
  };

  return (
    <>
      <FormField label={props.label}>
        {(p) => (
          <PickerWithAdd label={props.addLabel} onAdd={() => setAdding(true)}>
            <Combobox
              {...p}
              name={props.name}
              required={props.required}
              value={rows.some((r) => r.id === value) ? value : ""}
              onChange={pick}
              options={[
                { value: "", label: props.required ? t("filament:catalog.choose") : "" },
                ...rows.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </PickerWithAdd>
        )}
      </FormField>
      <CatalogAddDialog
        kind={props.kind}
        open={adding}
        title={t(
          isBrand ? "filament:catalog.brands.addTitle" : "filament:catalog.materials.addTitle",
        )}
        toBody={isBrand ? brandBody : materialBody}
        onClose={() => setAdding(false)}
        onSaved={(row) => pick(row.id, row)}
      >
        {isBrand ? <BrandFields /> : <MaterialFields />}
      </CatalogAddDialog>
    </>
  );
}
