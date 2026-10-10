import { useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import {
  type CatalogKind,
  type IMAGE_OF,
  imageUrl,
  isConflict,
  useBrands,
  useCatalogImage,
  useCatalogItem,
  useDeleteCatalog,
  useModelInfo,
  useSaveCatalog,
} from "../../lib/catalog.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const orNull = (v: string) => v || null;
const int = (v: string) => (v ? Math.round(Number(v)) : null);

/** Printer model `<select>`, grouped by brand. */
export function ModelSelect(props: React.ComponentProps<"select">) {
  const brands = useBrands().data ?? [];
  const info = [...useModelInfo().values()];
  return (
    // Remount once the options arrive: an uncontrolled select only applies defaultValue on mount.
    <select key={info.length} {...props} className={inputClass}>
      <option value="" />
      {brands.map((b) => (
        <optgroup key={b.id} label={b.name}>
          {info
            .filter((i) => i.model.brandId === b.id)
            .map(({ model: m }) => (
              <option key={m.id} value={m.id}>
                {m.model}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Header, save (then image upload), delete and errors for one catalog row. Create when the
 * route has no `$id`. Keys are passed in full so `pnpm i18n:check` sees them.
 */
export function CatalogForm<K extends CatalogKind>(props: {
  kind: K;
  /** Where to go after save / delete / back. */
  backTo?: "/printers" | "/filament";
  titles: [add: string, edit: string];
  imageLabel?: string;
  toBody: (f: FormData) => object;
  children: (row: ReturnType<typeof useCatalogItem<K>>["data"]) => ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id?: string };
  const item = useCatalogItem(props.kind, id);
  const save = useSaveCatalog(props.kind, id);
  const remove = useDeleteCatalog(props.kind);
  const image = useCatalogImage(props.kind as keyof typeof IMAGE_OF);
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const to = props.backTo ?? "/printers";
  const back = () => navigate({ to });
  const row = item.data;
  const imagePath =
    row && ("logoPath" in row ? row.logoPath : "imagePath" in row ? row.imagePath : null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save.mutate(props.toBody(new FormData(e.currentTarget)), {
      onSuccess: async (saved) => {
        if (file) await image.mutateAsync({ id: saved.id, file });
        back();
      },
    });
  };

  if (id && item.isError)
    return (
      <p role="alert" className="text-bad">
        {t("printers:catalog.notFound")}
      </p>
    );
  if (id && !row) return null;
  const error = save.error ?? image.error ?? remove.error;

  return (
    <>
      <PageHeader
        title={t(props.titles[id ? 1 : 0])}
        backTo={{ to }}
        actions={
          id && <Button onClick={() => setConfirm(true)}>{t("printers:catalog.delete")}</Button>
        }
      />
      {id && (
        <ConfirmDialog
          open={confirm}
          destructive
          title={t("printers:catalog.deleteTitle")}
          description={t("printers:catalog.deleteBody")}
          confirmLabel={t("printers:catalog.delete")}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            remove.mutate(id, { onSuccess: back });
          }}
        />
      )}
      <form key={row?.updatedAt} onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
        {props.children(row)}
        {props.imageLabel && (
          <FormField label={t(props.imageLabel)}>
            {(p) => (
              <div className="flex items-center gap-3">
                {row && imagePath && !file && (
                  <img
                    src={imageUrl(props.kind as keyof typeof IMAGE_OF, row)}
                    alt=""
                    className="size-16 rounded-md border border-border object-contain"
                  />
                )}
                <input
                  {...p}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {row && imagePath && (
                  <Button variant="ghost" onClick={() => image.mutate({ id: row.id, file: null })}>
                    {t("printers:catalog.removeImage")}
                  </Button>
                )}
              </div>
            )}
          </FormField>
        )}
        {error && (
          <p role="alert" className="text-bad">
            {t(
              !isConflict(error)
                ? "printers:catalog.error"
                : error === remove.error
                  ? "printers:catalog.inUse"
                  : "printers:catalog.duplicate",
            )}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending || image.isPending}>
            {t("printers:form.save")}
          </Button>
          <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
    </>
  );
}

export function BrandFormPage() {
  const { t } = useTranslation();
  return (
    <CatalogForm
      kind="brands"
      titles={["printers:catalog.brands.addTitle", "printers:catalog.brands.editTitle"]}
      imageLabel="printers:catalog.brands.logo"
      toBody={(f) => ({ name: text(f, "name"), url: orNull(text(f, "url")) })}
    >
      {(b) => (
        <>
          <FormField label={t("printers:catalog.brands.name")}>
            {(p) => (
              <input {...p} name="name" required className={inputClass} defaultValue={b?.name} />
            )}
          </FormField>
          <FormField label={t("printers:catalog.brands.url")}>
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

export function ModelFormPage() {
  const { t } = useTranslation();
  const brands = useBrands().data ?? [];
  return (
    <CatalogForm
      kind="printer-models"
      titles={["printers:catalog.models.addTitle", "printers:catalog.models.editTitle"]}
      imageLabel="printers:catalog.models.image"
      toBody={(f) => ({
        brandId: text(f, "brandId"),
        model: text(f, "model"),
        powerW: int(text(f, "powerW")),
      })}
    >
      {(m) => (
        <>
          <FormField
            label={t("printers:catalog.models.brand")}
            hint={brands.length ? undefined : t("printers:catalog.models.noBrands")}
          >
            {(p) => (
              <select
                key={brands.length}
                {...p}
                name="brandId"
                required
                className={inputClass}
                defaultValue={m?.brandId}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t("printers:catalog.models.model")}>
            {(p) => (
              <input {...p} name="model" required className={inputClass} defaultValue={m?.model} />
            )}
          </FormField>
          <FormField label={t("printers:form.power")} hint={t("printers:catalog.models.powerHint")}>
            {(p) => (
              <input
                {...p}
                name="powerW"
                type="number"
                min={0}
                step={1}
                className={inputClass}
                defaultValue={m?.powerW ?? ""}
              />
            )}
          </FormField>
        </>
      )}
    </CatalogForm>
  );
}

export function MachineProfileFormPage() {
  const { t } = useTranslation();
  return (
    <CatalogForm
      kind="machine-profiles"
      titles={["printers:catalog.profiles.addTitle", "printers:catalog.profiles.editTitle"]}
      toBody={(f) => ({
        name: text(f, "name"),
        printerModelId: text(f, "printerModelId"),
        nozzleDiameterMm: Number(text(f, "nozzle")),
        sourcePreset: orNull(text(f, "sourcePreset")),
      })}
    >
      {(mp) => (
        <>
          <FormField label={t("printers:catalog.profiles.name")}>
            {(p) => (
              <input {...p} name="name" required className={inputClass} defaultValue={mp?.name} />
            )}
          </FormField>
          <FormField label={t("printers:catalog.profiles.model")}>
            {(p) => (
              <ModelSelect
                {...p}
                name="printerModelId"
                required
                defaultValue={mp?.printerModelId}
              />
            )}
          </FormField>
          <FormField label={t("printers:catalog.profiles.nozzle")}>
            {(p) => (
              <input
                {...p}
                name="nozzle"
                type="number"
                required
                min={0.1}
                step={0.05}
                className={inputClass}
                defaultValue={mp?.nozzleDiameterMm ?? 0.4}
              />
            )}
          </FormField>
          <FormField
            label={t("printers:catalog.profiles.source")}
            hint={t("printers:catalog.profiles.sourceHint")}
          >
            {(p) => (
              <input
                {...p}
                name="sourcePreset"
                className={inputClass}
                defaultValue={mp?.sourcePreset ?? ""}
              />
            )}
          </FormField>
        </>
      )}
    </CatalogForm>
  );
}
