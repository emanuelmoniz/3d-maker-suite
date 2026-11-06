import { useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveActions, ArchivedBadge } from "../../components/ArchiveActions.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PickerWithAdd } from "../../components/PickerWithAdd.tsx";
import { Write } from "../../components/Write.tsx";
import {
  type CatalogKind,
  type CatalogRow,
  type IMAGE_OF,
  imageUrl,
  isConflict,
  useBrands,
  useCatalogImage,
  useCatalogItem,
  useCatalogPicker,
  useCatalogWithArchived,
  useModelInfo,
  useSaveCatalog,
} from "../../lib/catalog.ts";
import { sourceLabel } from "../catalog/sources.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * What brought the row, when a file did: the next import finds it by its name, so that is locked
 * (ADR-0020). Null for a row made by hand.
 */
export const lockedBy = (row?: { source?: string }) =>
  row?.source && row.source !== "hand" ? row.source : null;

/** The hint under a locked name. */
export function useLockHint(row?: { source?: string }) {
  const { t } = useTranslation();
  const source = lockedBy(row);
  return source ? t("catalog:nameLocked", { source: sourceLabel(t, source) }) : undefined;
}
const orNull = (v: string) => v || null;
const int = (v: string) => (v ? Math.round(Number(v)) : null);

/** Printer model picker, grouped by brand. */
export function ModelSelect(props: Omit<React.ComponentProps<typeof Combobox>, "options">) {
  const brands = useCatalogWithArchived("brands").data ?? [];
  const own = props.value ?? props.defaultValue;
  // An archived model isn't offered, unless it is the one the row already has.
  const info = [...useModelInfo().values()].filter(({ model: m }) => !m.archivedAt || m.id === own);
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
  const brands = useCatalogPicker("brands", defaultValue);
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
  /** The Catalog tab to go back to after save / delete / back; the row's table is its `kind`. */
  backTo?: "/catalog/printers" | "/catalog/filament";
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
  const image = useCatalogImage(props.kind as keyof typeof IMAGE_OF);
  const [file, setFile] = useState<File | null>(null);
  const to = props.backTo ?? "/catalog/printers";
  const back = () => navigate({ to, hash: props.kind });
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
  const error = save.error ?? image.error;

  return (
    <>
      <PageHeader
        title={t(props.titles[id ? 1 : 0])}
        backTo={{ to: `${to}#${props.kind}` as typeof to }}
        description={row?.archivedAt && <ArchivedBadge />}
        actions={
          row && (
            <Write can="catalog" level="manage">
              <ArchiveActions
                path={`/api/${props.kind}/${row.id}`}
                name={"name" in row ? row.name : row.model}
                archived={row.archivedAt !== null}
                onDeleted={back}
              />
            </Write>
          )
        }
      />
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
            {t(isConflict(error) ? "printers:catalog.duplicate" : "printers:catalog.error")}
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

export function BrandFields({ b }: { b?: { name: string; url: string | null; source?: string } }) {
  const { t } = useTranslation();
  const locked = useLockHint(b);
  return (
    <>
      <FormField label={t("printers:catalog.brands.name")} hint={locked}>
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
  m?: { brandId: string; model: string; powerW: number | null; source?: string };
}) {
  const { t } = useTranslation();
  const brands = useBrands().data ?? [];
  const locked = useLockHint(m);
  const brandName = useCatalogWithArchived("brands").data?.find((b) => b.id === m?.brandId)?.name;
  return (
    <>
      <FormField
        label={t("printers:catalog.models.brand")}
        hint={brands.length ? undefined : t("printers:catalog.models.noBrands")}
      >
        {(p) =>
          locked ? (
            <>
              <input {...p} readOnly className={inputClass} value={brandName ?? ""} />
              <input type="hidden" name="brandId" value={m?.brandId} />
            </>
          ) : (
            <BrandPicker {...p} defaultValue={m?.brandId} />
          )
        }
      </FormField>
      <FormField label={t("printers:catalog.models.model")} hint={locked}>
        {(p) => (
          <input
            {...p}
            name="model"
            required
            readOnly={!!locked}
            className={inputClass}
            defaultValue={m?.model}
          />
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
