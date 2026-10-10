import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { CatalogForm } from "../printers/CatalogForms.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const orNull = (v: string) => v || null;
const int = (v: string) => (v ? Math.round(Number(v)) : null);
const float = (v: string) => (v ? Number(v) : null);

export function FilamentBrandFormPage() {
  const { t } = useTranslation();
  return (
    <CatalogForm
      kind="filament-brands"
      backTo="/filament"
      titles={["filament:catalog.brands.addTitle", "filament:catalog.brands.editTitle"]}
      imageLabel="filament:catalog.brands.logo"
      toBody={(f) => ({ name: text(f, "name"), url: orNull(text(f, "url")) })}
    >
      {(b) => (
        <>
          <FormField label={t("filament:catalog.brands.name")}>
            {(p) => (
              <input {...p} name="name" required className={inputClass} defaultValue={b?.name} />
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
      )}
    </CatalogForm>
  );
}

export function FilamentMaterialFormPage() {
  const { t } = useTranslation();
  return (
    <CatalogForm
      kind="filament-materials"
      backTo="/filament"
      titles={["filament:catalog.materials.addTitle", "filament:catalog.materials.editTitle"]}
      toBody={(f) => ({
        name: text(f, "name"),
        nozzleTempC: int(text(f, "nozzle")),
        bedTempC: int(text(f, "bed")),
        densityGcm3: float(text(f, "density")),
      })}
    >
      {(m) => (
        <>
          <FormField label={t("filament:catalog.materials.name")}>
            {(p) => (
              <input {...p} name="name" required className={inputClass} defaultValue={m?.name} />
            )}
          </FormField>
          <p className="text-sm text-muted">{t("filament:catalog.materials.defaultsHint")}</p>
          <FormField label={t("filament:profiles.nozzleTemp")}>
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
          <FormField label={t("filament:profiles.bedTemp")}>
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
          <FormField label={t("filament:profiles.density")}>
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
        </>
      )}
    </CatalogForm>
  );
}
