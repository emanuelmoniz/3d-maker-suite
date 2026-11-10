import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { usePreferences } from "../../lib/preferences.ts";
import { CatalogForm, useLockHint } from "../printers/CatalogForms.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const orNull = (v: string) => v || null;
const int = (v: string) => (v ? Math.round(Number(v)) : null);
const float = (v: string) => (v ? Number(v) : null);
const minor = (v: string) => (v ? Math.round(Number(v) * 100) : null);

export function FilamentBrandFormPage() {
  return (
    <CatalogForm
      kind="filament-brands"
      backTo="/catalog/filament"
      titles={["filament:catalog.brands.addTitle", "filament:catalog.brands.editTitle"]}
      imageLabel="filament:catalog.brands.logo"
      toBody={(f) => ({ name: text(f, "name"), url: orNull(text(f, "url")) })}
    >
      {(b) => <FilamentBrandFields b={b} />}
    </CatalogForm>
  );
}

function FilamentBrandFields({ b }: { b?: { name: string; url: string | null; source?: string } }) {
  const { t } = useTranslation();
  const locked = useLockHint(b);
  return (
    <>
      <FormField label={t("filament:catalog.brands.name")} hint={locked}>
        {(p) => (
          <input
            {...p}
            name="name"
            required
            readOnly={!!locked}
            className={inputClass}
            defaultValue={b?.name}
          />
        )}
      </FormField>
      <FormField label={t("filament:catalog.brands.url")}>
        {(p) => (
          <input
            {...p}
            name="url"
            type="url"
            placeholder="https://"
            className={inputClass}
            defaultValue={b?.url ?? ""}
          />
        )}
      </FormField>
    </>
  );
}

export function MaterialFields({
  m,
}: {
  m?: {
    name: string;
    nozzleTempC: number | null;
    bedTempC: number | null;
    densityGcm3: number | null;
    pricePerKg: number | null;
    source?: string;
  };
}) {
  const { t } = useTranslation();
  const currency = usePreferences().data?.values.currency ?? "";
  const locked = useLockHint(m);
  return (
    <>
      <FormField label={t("filament:catalog.materials.name")} hint={locked}>
        {(p) => (
          <input
            {...p}
            name="name"
            required
            readOnly={!!locked}
            className={inputClass}
            defaultValue={m?.name}
          />
        )}
      </FormField>
      <p className="text-sm text-muted">{t("filament:catalog.materials.defaultsHint")}</p>
      <FormField label={t("filament:presets.nozzleTemp")}>
        {(p) => (
          <input
            {...p}
            name="nozzle"
            type="number"
            min={1}
            step={1}
            className={inputClass}
            defaultValue={m?.nozzleTempC ?? ""}
          />
        )}
      </FormField>
      <FormField label={t("filament:presets.bedTemp")}>
        {(p) => (
          <input
            {...p}
            name="bed"
            type="number"
            min={0}
            step={1}
            className={inputClass}
            defaultValue={m?.bedTempC ?? ""}
          />
        )}
      </FormField>
      <FormField label={t("filament:presets.density")}>
        {(p) => (
          <input
            {...p}
            name="density"
            type="number"
            min={0.1}
            step={0.01}
            className={inputClass}
            defaultValue={m?.densityGcm3 ?? ""}
          />
        )}
      </FormField>
      <FormField
        label={`${t("filament:catalog.materials.pricePerKg")} (${currency})`}
        hint={t("filament:catalog.materials.pricePerKgHint")}
      >
        {(p) => (
          <input
            {...p}
            name="price"
            type="number"
            min={0}
            step={0.01}
            className={inputClass}
            defaultValue={m?.pricePerKg == null ? "" : m.pricePerKg / 100}
          />
        )}
      </FormField>
    </>
  );
}

export const materialBody = (f: FormData) => ({
  name: text(f, "name"),
  nozzleTempC: int(text(f, "nozzle")),
  bedTempC: int(text(f, "bed")),
  densityGcm3: float(text(f, "density")),
  pricePerKg: minor(text(f, "price")),
});

export function FilamentMaterialFormPage() {
  return (
    <CatalogForm
      kind="filament-materials"
      backTo="/catalog/filament"
      titles={["filament:catalog.materials.addTitle", "filament:catalog.materials.editTitle"]}
      toBody={materialBody}
    >
      {(m) => <MaterialFields m={m} />}
    </CatalogForm>
  );
}
