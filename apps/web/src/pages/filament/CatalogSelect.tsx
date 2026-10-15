import type { FilamentBrand, FilamentMaterial } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import {
  isConflict,
  useFilamentBrands,
  useFilamentMaterials,
  useSaveCatalog,
} from "../../lib/catalog.ts";

type Kind = "filament-brands" | "filament-materials";
type Row = FilamentBrand | FilamentMaterial;

/** A brand / material picker with an inline "add new", for the filament profile form. */
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
  const rows: Row[] = (props.kind === "filament-brands" ? brands.data : materials.data) ?? [];
  const save = useSaveCatalog(props.kind);
  const [value, setValue] = useState(props.defaultValue ?? "");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const pick = (id: string) => {
    setValue(id);
    props.onPick?.(rows.find((r) => r.id === id));
  };
  const add = async () => {
    if (!name.trim()) return;
    try {
      const row = await save.mutateAsync({ name: name.trim() });
      pick(row.id);
      setAdding(false);
      setName("");
    } catch {} // shown through save.error
  };

  return (
    <div className="grid gap-2">
      <FormField label={props.label}>
        {(p) => (
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
        )}
      </FormField>
      {adding ? (
        <div className="flex gap-2">
          <input
            aria-label={props.addLabel}
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // not the profile form's submit
                add();
              }
            }}
          />
          <Button onClick={add} disabled={save.isPending}>
            {t("filament:catalog.addConfirm")}
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            {t("common:actions.cancel")}
          </Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)}>
          {props.addLabel}
        </Button>
      )}
      {save.isError && (
        <p role="alert" className="text-bad">
          {t(isConflict(save.error) ? "printers:catalog.duplicate" : "printers:catalog.error")}
        </p>
      )}
    </div>
  );
}
