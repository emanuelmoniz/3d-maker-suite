import type { Accessory, AccessoryInput } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagPicker } from "../../components/TagPicker.tsx";
import {
  useAccessory,
  useAccessoryTypes,
  useCreateAccessory,
  usePatchAccessory,
} from "../../lib/accessories.ts";
import { isConflict } from "../../lib/catalog.ts";
import { dateInputToIso, isoToDateInput } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useTagEditor } from "../../lib/tags.ts";
import { CostFields, readCostFields } from "./CostFields.tsx";
import { useStateLabel } from "./StateBadge.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const orNull = (v: string) => v || null;
const date = (v: string) => (v ? dateInputToIso(v) : null);

/** Create (no `accessory`) or edit; the printer form's fields minus the printer-only ones. */
function AccessoryForm({ accessory }: { accessory?: Accessory }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stateLabel = useStateLabel();
  const prefs = usePreferences().data?.values;
  const create = useCreateAccessory();
  const patch = usePatchAccessory(accessory?.id ?? "");
  const save = accessory ? patch : create;
  const states = prefs?.printerStates ?? [];
  const types = useAccessoryTypes().data ?? [];
  const typeList = useId();
  const tags = useTagEditor("accessory", accessory?.id);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: AccessoryInput = {
      number: text(f, "number") ? Number(text(f, "number")) : undefined,
      name: text(f, "name"),
      type: text(f, "type"),
      serial: orNull(text(f, "serial")),
      state: text(f, "state"),
      powerW: text(f, "powerW") ? Math.round(Number(text(f, "powerW"))) : null,
      purchasedAt: date(text(f, "purchasedAt")),
      purchasePrice: text(f, "purchasePrice")
        ? Math.round(Number(text(f, "purchasePrice")) * 100)
        : null,
      warrantyEndsAt: date(text(f, "warrantyEndsAt")),
      warrantyNotes: orNull(text(f, "warrantyNotes")),
      ...readCostFields(f, "accessory"),
    };
    save.mutate(body, {
      onSuccess: async (saved) => {
        const { id } = saved as Accessory;
        await tags.persist(id);
        navigate({ to: "/printers/accessories/$id", params: { id } });
      },
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      <FormField
        label={t("printers:form.number")}
        hint={accessory ? undefined : t("printers:form.numberHint")}
      >
        {(p) => (
          <input
            {...p}
            name="number"
            type="number"
            min={1}
            step={1}
            className={inputClass}
            defaultValue={accessory?.number}
          />
        )}
      </FormField>
      <FormField label={t("printers:form.name")}>
        {(p) => (
          <input
            {...p}
            name="name"
            required
            className={inputClass}
            defaultValue={accessory?.name}
          />
        )}
      </FormField>
      <FormField
        label={t("printers:accessories.form.type")}
        hint={t("printers:accessories.form.typeHint")}
      >
        {(p) => (
          <>
            <input
              {...p}
              name="type"
              required
              list={typeList}
              className={inputClass}
              defaultValue={accessory?.type}
            />
            <datalist id={typeList}>
              {types.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </>
        )}
      </FormField>
      <FormField label={t("printers:form.serial")}>
        {(p) => (
          <input
            {...p}
            name="serial"
            className={inputClass}
            defaultValue={accessory?.serial ?? ""}
          />
        )}
      </FormField>
      <FormField label={t("printers:form.state")}>
        {(p) => (
          <Combobox
            {...p}
            name="state"
            defaultValue={accessory?.state ?? states[0]}
            // a state since removed from Settings stays selectable on accessories that have it
            options={[...new Set([...states, ...(accessory ? [accessory.state] : [])])].map(
              (s) => ({ value: s, label: stateLabel(s) }),
            )}
          />
        )}
      </FormField>
      <FormField label={t("printers:form.power")}>
        {(p) => (
          <input
            {...p}
            name="powerW"
            type="number"
            min={0}
            step={1}
            className={inputClass}
            defaultValue={accessory?.powerW ?? ""}
          />
        )}
      </FormField>
      <FormField label={t("printers:form.purchasedAt")}>
        {(p) => (
          <input
            {...p}
            name="purchasedAt"
            type="date"
            className={inputClass}
            defaultValue={isoToDateInput(accessory?.purchasedAt ?? null)}
          />
        )}
      </FormField>
      <FormField label={`${t("printers:form.purchasePrice")} (${prefs?.currency ?? ""})`}>
        {(p) => (
          <input
            {...p}
            name="purchasePrice"
            type="number"
            min={0}
            step={0.01}
            className={inputClass}
            defaultValue={accessory?.purchasePrice == null ? "" : accessory.purchasePrice / 100}
          />
        )}
      </FormField>
      <CostFields values={accessory} kind="accessory" />
      <FormField label={t("printers:form.warrantyEndsAt")}>
        {(p) => (
          <input
            {...p}
            name="warrantyEndsAt"
            type="date"
            className={inputClass}
            defaultValue={isoToDateInput(accessory?.warrantyEndsAt ?? null)}
          />
        )}
      </FormField>
      <FormField label={t("printers:form.warrantyNotes")}>
        {(p) => (
          <textarea
            {...p}
            name="warrantyNotes"
            className={`${inputClass} h-20 py-2`}
            defaultValue={accessory?.warrantyNotes ?? ""}
          />
        )}
      </FormField>
      <TagPicker value={tags.value} onChange={tags.onChange} />
      {save.isError && (
        <p role="alert" className="text-bad">
          {t(
            isConflict(save.error)
              ? "printers:accessories.form.numberTaken"
              : "printers:accessories.form.saveError",
          )}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t("printers:form.save")}
        </Button>
        <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}

export function AccessoryCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("printers:accessories.form.addTitle")} backTo={{ to: "/printers" }} />
      <AccessoryForm />
    </>
  );
}

export function AccessoryEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, isError } = useAccessory(id);
  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("printers:accessories.detail.notFound")}
      </p>
    );
  if (!data) return null;
  return (
    <>
      <PageHeader
        title={t("printers:accessories.form.editTitle")}
        backTo={{ to: "/printers/accessories/$id", params: { id } }}
      />
      <AccessoryForm key={data.updatedAt} accessory={data} />
    </>
  );
}
