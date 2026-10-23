import { useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PickerWithAdd } from "../../components/PickerWithAdd.tsx";
import {
  type CatalogKind,
  type CatalogRow,
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

/** Printer model picker, grouped by brand. */
export function ModelSelect(props: Omit<React.ComponentProps<typeof Combobox>, "options">) {
  const brands = useBrands().data ?? [];
  const info = [...useModelInfo().values()];
  return (
    // Remount once the options arrive: an uncontrolled picker only applies defaultValue on mount.
    <Combobox
      key={info.length}
      {...props}
      options={[
        { value: "", label: "" },
        ...brands.flatMap((b) =>
          info
            .filter((i) => i.model.brandId === b.id)
            .map(({ model: m }) => ({ value: m.id, label: m.model, group: b.name })),
        ),
      ]}
    />
  );
}

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

/** "Add" modal for one catalog row: `children` are its fields, `toBody` reads them. */
export function CatalogAddDialog<K extends CatalogKind>(props: {
  kind: K;
  open: boolean;
  title: string;
  toBody: (f: FormData) => object;
  onClose: () => void;
  onSaved: (row: CatalogRow<K>) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const save = useSaveCatalog(props.kind);
  const close = () => {
    save.reset();
    props.onClose();
  };
  return (
    <FormDialog
      open={props.open}
      title={props.title}
      error={
        save.error
          ? t(isConflict(save.error) ? "printers:catalog.duplicate" : "printers:catalog.error")
          : undefined
      }
      busy={save.isPending}
      onCancel={close}
      onSubmit={(f) =>
        save.mutate(props.toBody(f), {
          onSuccess: (row) => {
            props.onSaved(row);
            close();
          },
        })
      }
    >
      {props.children}
    </FormDialog>
  );
}

/** Brand picker (`brandId`) with "+ Add brand". */
export function BrandPicker({ defaultValue, ...p }: ControlProps & { defaultValue?: string }) {
  const { t } = useTranslation();
  const brands = useBrands().data ?? [];
  const [id, setId] = useState(defaultValue);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PickerWithAdd label={t("printers:catalog.brands.add")} onAdd={() => setAdding(true)}>
        <Combobox
          key={brands.length}
          {...p}
          name="brandId"
          required
          defaultValue={id}
          onChange={setId}
          options={brands.map((b) => ({ value: b.id, label: b.name }))}
        />
      </PickerWithAdd>
      <CatalogAddDialog
        kind="brands"
        open={adding}
        title={t("printers:catalog.brands.addTitle")}
        toBody={brandBody}
        onClose={() => setAdding(false)}
        onSaved={(b) => setId(b.id)}
      >
        <BrandFields />
      </CatalogAddDialog>
    </>
  );
}

/** Model picker with "+ Add model"; `onChange` also gets the row when it was just added. */
export function ModelPicker({
  defaultValue,
  onChange,
  ...p
}: ControlProps & {
  name: string;
  required?: boolean;
  defaultValue?: string;
  onChange?: (id: string, added?: CatalogRow<"printer-models">) => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState(defaultValue);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PickerWithAdd label={t("printers:catalog.models.add")} onAdd={() => setAdding(true)}>
        <ModelSelect
          {...p}
          defaultValue={id}
          onChange={(v) => {
            setId(v);
            onChange?.(v);
          }}
        />
      </PickerWithAdd>
      <CatalogAddDialog
        kind="printer-models"
        open={adding}
        title={t("printers:catalog.models.addTitle")}
        toBody={modelBody}
        onClose={() => setAdding(false)}
        onSaved={(m) => {
          setId(m.id);
          onChange?.(m.id, m);
        }}
      >
        <ModelFields />
      </CatalogAddDialog>
    </>
  );
}

/**
 * Header, save (then image upload), delete and errors for one catalog row. Create when the
 * route has no `$id`. Keys are passed in full so `pnpm i18n:check` sees them.
 */
export function CatalogForm<K extends CatalogKind>(props: {
  kind: K;
  /** Where to go after save / delete / back. */
  backTo?: "/printers/settings" | "/filament/settings";
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
  const to = props.backTo ?? "/printers/settings";
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

export function BrandFields({ b }: { b?: { name: string; url: string | null } }) {
  const { t } = useTranslation();
  return (
    <>
      <FormField label={t("printers:catalog.brands.name")}>
        {(p) => <input {...p} name="name" required className={inputClass} defaultValue={b?.name} />}
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
  );
}

export const brandBody = (f: FormData) => ({ name: text(f, "name"), url: orNull(text(f, "url")) });

export function BrandFormPage() {
  return (
    <CatalogForm
      kind="brands"
      titles={["printers:catalog.brands.addTitle", "printers:catalog.brands.editTitle"]}
      imageLabel="printers:catalog.brands.logo"
      toBody={brandBody}
    >
      {(b) => <BrandFields b={b} />}
    </CatalogForm>
  );
}

export function ModelFields({
  m,
}: {
  m?: { brandId: string; model: string; powerW: number | null };
}) {
  const { t } = useTranslation();
  const brands = useBrands().data ?? [];
  return (
    <>
      <FormField
        label={t("printers:catalog.models.brand")}
        hint={brands.length ? undefined : t("printers:catalog.models.noBrands")}
      >
        {(p) => <BrandPicker {...p} defaultValue={m?.brandId} />}
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
  );
}

export const modelBody = (f: FormData) => ({
  brandId: text(f, "brandId"),
  model: text(f, "model"),
  powerW: int(text(f, "powerW")),
});

export function ModelFormPage() {
  return (
    <CatalogForm
      kind="printer-models"
      titles={["printers:catalog.models.addTitle", "printers:catalog.models.editTitle"]}
      imageLabel="printers:catalog.models.image"
      toBody={modelBody}
    >
      {(m) => <ModelFields m={m} />}
    </CatalogForm>
  );
}

export function MachineProfileFields({
  mp,
  modelId,
}: {
  mp?: CatalogRow<"machine-profiles">;
  /** Preselected model for a new profile. */
  modelId?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <FormField label={t("printers:catalog.profiles.name")}>
        {(p) => (
          <input {...p} name="name" required className={inputClass} defaultValue={mp?.name} />
        )}
      </FormField>
      <FormField label={t("printers:catalog.profiles.model")}>
        {(p) => (
          <ModelPicker
            {...p}
            name="printerModelId"
            required
            defaultValue={mp?.printerModelId ?? modelId}
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
  );
}

export const machineProfileBody = (f: FormData) => ({
  name: text(f, "name"),
  printerModelId: text(f, "printerModelId"),
  nozzleDiameterMm: Number(text(f, "nozzle")),
  sourcePreset: orNull(text(f, "sourcePreset")),
});

export function MachineProfileFormPage() {
  return (
    <CatalogForm
      kind="machine-profiles"
      titles={["printers:catalog.profiles.addTitle", "printers:catalog.profiles.editTitle"]}
      toBody={machineProfileBody}
    >
      {(mp) => <MachineProfileFields mp={mp} />}
    </CatalogForm>
  );
}

const optNumber = (v: string) => (v ? Number(v) : null);

export function PrintProfileFields({
  pp,
  modelId,
}: {
  pp?: CatalogRow<"print-profiles">;
  /** Preselected model for a new profile. */
  modelId?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <FormField label={t("printers:catalog.printProfiles.name")}>
        {(p) => (
          <input {...p} name="name" required className={inputClass} defaultValue={pp?.name} />
        )}
      </FormField>
      <FormField label={t("printers:catalog.printProfiles.model")}>
        {(p) => (
          <ModelPicker
            {...p}
            name="printerModelId"
            defaultValue={pp ? (pp.printerModelId ?? "") : (modelId ?? "")}
          />
        )}
      </FormField>
      <FormField label={t("printers:catalog.printProfiles.nozzle")}>
        {(p) => (
          <input
            {...p}
            name="nozzle"
            type="number"
            min={0.1}
            step={0.05}
            className={inputClass}
            defaultValue={pp?.nozzleDiameterMm ?? ""}
          />
        )}
      </FormField>
      <FormField label={t("printers:catalog.printProfiles.layer")}>
        {(p) => (
          <input
            {...p}
            name="layer"
            type="number"
            min={0.01}
            step={0.01}
            className={inputClass}
            defaultValue={pp?.layerHeightMm ?? ""}
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
            defaultValue={pp?.sourcePreset ?? ""}
          />
        )}
      </FormField>
    </>
  );
}

export const printProfileBody = (f: FormData) => ({
  name: text(f, "name"),
  printerModelId: orNull(text(f, "printerModelId")),
  nozzleDiameterMm: optNumber(text(f, "nozzle")),
  layerHeightMm: optNumber(text(f, "layer")),
  sourcePreset: orNull(text(f, "sourcePreset")),
});

export function PrintProfileFormPage() {
  return (
    <CatalogForm
      kind="print-profiles"
      titles={[
        "printers:catalog.printProfiles.addTitle",
        "printers:catalog.printProfiles.editTitle",
      ]}
      toBody={printProfileBody}
    >
      {(pp) => <PrintProfileFields pp={pp} />}
    </CatalogForm>
  );
}
