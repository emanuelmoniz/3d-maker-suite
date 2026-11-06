import type { FilamentBrand, FilamentMaterial } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField } from "../../components/FormField.tsx";
import { PickerWithAdd } from "../../components/PickerWithAdd.tsx";
import { useCan } from "../../lib/auth.ts";
import { useCatalogPicker } from "../../lib/catalog.ts";
import { BrandFields, brandBody, CatalogAddDialog } from "../printers/CatalogForms.tsx";
import { MaterialFields, materialBody } from "./CatalogForms.tsx";

type Kind = "filament-brands" | "filament-materials";
type Row = FilamentBrand | FilamentMaterial;

/**
 * A brand / material picker, for the spool and filament profile forms; with `catalog` manage, a
 * "+ Add …" beside it (a modal).
 */
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
  const isBrand = props.kind === "filament-brands";
  const rows: Row[] = useCatalogPicker<Kind>(props.kind, props.defaultValue);
  const [value, setValue] = useState(props.defaultValue ?? "");
  const [adding, setAdding] = useState(false);
  const canAdd = useCan("catalog", "manage");

  const pick = (id: string, row = rows.find((r) => r.id === id)) => {
    setValue(id);
    props.onPick?.(row);
  };

  return (
    <>
      <FormField label={props.label}>
        {(p) => {
          const picker = (
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
          );
          return canAdd ? (
            <PickerWithAdd label={props.addLabel} onAdd={() => setAdding(true)}>
              {picker}
            </PickerWithAdd>
          ) : (
            picker
          );
        }}
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
