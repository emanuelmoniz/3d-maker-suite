import { SPOOL_STATUSES, type Spool } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagPicker } from "../../components/TagPicker.tsx";
import { isConflict } from "../../lib/catalog.ts";
import { useCreateSpool, usePatchSpool, useSpool } from "../../lib/filament.ts";
import { dateInputToIso, isoToDateInput } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useTagEditor } from "../../lib/tags.ts";
import { CatalogSelect } from "./CatalogSelect.tsx";
import { STATUS } from "./FilamentPage.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);
const float = (v: string) => (v ? Number(v) : null);

/**
 * Create, or edit `spool`. The remaining weight only changes through "Adjust weight". With
 * `onSaved` (a dialog) it hands the saved spool back instead of leaving the page.
 */
export function SpoolForm({
  spool,
  colorHex,
  materialId,
  openedAt,
  onSaved,
  onCancel = () => history.back(),
}: {
  spool?: Spool;
  /** The new spool's colour, material and opening day to start from. */
  colorHex?: string;
  materialId?: string;
  openedAt?: string;
  onSaved?: (spool: Spool) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateSpool();
  const patch = usePatchSpool();
  const save = spool ? patch : create;
  const tags = useTagEditor("spool", spool?.id);
  const prefs = usePreferences().data?.values;
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const date = (k: string) => (text(f, k) ? dateInputToIso(text(f, k)) : null);
    const values = {
      brandId: text(f, "brandId") || null,
      materialId: text(f, "materialId"),
      name: text(f, "filamentName") || null,
      number: num(text(f, "number")) ?? undefined,
      colorHex: text(f, "color"),
      colorName: text(f, "colorName") || null,
      // Empty = weight not known yet; once known it can't go back.
      initialGrams: float(text(f, "initial")),
      emptyWeightGrams: float(text(f, "empty")),
      lowGrams: float(text(f, "lowGrams")),
      // On is the default, so only "off" is stored.
      lowAlert: f.has("lowAlert") ? null : false,
      pricePaid: num(text(f, "price"), 100),
      purchasedAt: date("purchasedAt"),
      openedAt: date("openedAt"),
      location: text(f, "location") || null,
    };
    const done = async (saved: Spool) => {
      await tags.persist(saved.id);
      if (onSaved) return onSaved(saved);
      navigate(
        spool ? { to: "/filament/spools/$id", params: { id: saved.id } } : { to: "/filament" },
      );
    };
    // mutateAsync, not mutate's onSuccess: saving refetches the spool, the edit page remounts this
    // form (key=updatedAt) and mutate-level callbacks are dropped once the form is unmounted.
    const request = spool
      ? patch.mutateAsync({
          id: spool.id,
          patch: { ...values, status: text(f, "status") as Spool["status"] },
        })
      : create.mutateAsync({ ...values, remainingGrams: float(text(f, "remaining")) ?? undefined });
    request.then((saved) => done(saved as Spool)).catch(() => {}); // errors show via save.error
  };
  const field = (
    name: string,
    key: string,
    props: React.ComponentProps<"input"> = {},
    hint?: string,
  ) => (
    <FormField label={t(key)} hint={hint}>
      {(p) =>
        props.type === "date" ? (
          <DateInput {...p} name={name} defaultValue={props.defaultValue as string} />
        ) : (
          <input {...p} name={name} className={inputClass} {...props} />
        )
      }
    </FormField>
  );
  const grams = { type: "number", min: 0, step: 0.01 } as const;
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      {field(
        "number",
        "filament:spools.number",
        { type: "number", min: 1, step: 1, defaultValue: spool?.number },
        spool ? undefined : t("filament:spools.numberHint"),
      )}
      <CatalogSelect
        kind="filament-brands"
        name="brandId"
        label={t("filament:spools.brand")}
        addLabel={t("filament:catalog.brands.add")}
        defaultValue={spool?.brandId}
      />
      <CatalogSelect
        kind="filament-materials"
        name="materialId"
        label={t("filament:spools.material")}
        addLabel={t("filament:catalog.materials.add")}
        required
        defaultValue={spool?.materialId ?? materialId}
      />
      {field(
        "filamentName",
        "filament:spools.filamentName",
        { defaultValue: spool?.name ?? "" },
        t("filament:spools.filamentNameHint"),
      )}
      <FormField label={t("filament:spools.color")}>
        {(p) => (
          <input
            {...p}
            name="color"
            type="color"
            defaultValue={spool?.colorHex ?? colorHex ?? "#808080"}
            className={inputClass}
          />
        )}
      </FormField>
      {field("colorName", "filament:spools.colorName", { defaultValue: spool?.colorName ?? "" })}
      {field(
        "initial",
        "filament:spools.initial",
        {
          ...grams,
          required: spool?.initialGrams != null,
          defaultValue: spool ? (spool.initialGrams ?? undefined) : 1000,
        },
        spool?.initialGrams != null ? undefined : t("filament:spools.initialHint"),
      )}
      {spool ? (
        <FormField label={t("filament:spools.status")}>
          {(p) => (
            <Combobox
              {...p}
              name="status"
              defaultValue={spool.status}
              options={SPOOL_STATUSES.map((s) => ({ value: s, label: t(STATUS[s]) }))}
            />
          )}
        </FormField>
      ) : (
        field(
          "remaining",
          "filament:spools.remainingNow",
          grams,
          t("filament:spools.remainingHint"),
        )
      )}
      {field("empty", "filament:spools.emptyWeight", {
        ...grams,
        defaultValue: spool?.emptyWeightGrams ?? undefined,
      })}
      {field(
        "lowGrams",
        "filament:spools.lowGrams",
        { ...grams, defaultValue: spool?.lowGrams ?? undefined },
        t("filament:spools.lowGramsHint", { grams: prefs?.lowSpoolGrams }),
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="lowAlert" defaultChecked={spool?.lowAlert !== false} />
        {t("filament:spools.lowAlert")}
      </label>
      {field("price", "filament:spools.price", {
        type: "number",
        min: 0,
        step: 0.01,
        defaultValue: spool?.pricePaid == null ? undefined : spool.pricePaid / 100,
      })}
      {field("purchasedAt", "filament:spools.purchasedAt", {
        type: "date",
        defaultValue: isoToDateInput(spool?.purchasedAt ?? null),
      })}
      {field("openedAt", "filament:spools.openedAt", {
        type: "date",
        defaultValue: isoToDateInput(spool?.openedAt ?? openedAt ?? null),
      })}
      {field("location", "filament:spools.locationLabel", {
        defaultValue: spool?.location ?? "",
      })}
      <TagPicker value={tags.value} onChange={tags.onChange} />
      {save.isError && (
        <p role="alert" className="text-bad">
          {t(isConflict(save.error) ? "filament:spools.numberTaken" : "filament:spools.error")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t("filament:spools.save")}
        </Button>
        <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}

export function SpoolCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("filament:spools.addTitle")} backTo={{ to: "/filament" }} />
      <SpoolForm />
    </>
  );
}

export function SpoolEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data } = useSpool(id);
  return (
    <>
      <PageHeader
        title={t("filament:spools.editTitle")}
        backTo={{ to: "/filament/spools/$id", params: { id } }}
      />
      {/* key: the form is uncontrolled, so remount when the saved spool arrives */}
      {data && <SpoolForm key={data.updatedAt} spool={data} />}
    </>
  );
}
