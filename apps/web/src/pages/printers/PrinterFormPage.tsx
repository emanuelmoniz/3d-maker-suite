import type { Printer, PrinterInput, PrintProfile } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PickerWithAdd } from "../../components/PickerWithAdd.tsx";
import { TagPicker } from "../../components/TagPicker.tsx";
import { isConflict, useModelInfo, usePrintProfiles } from "../../lib/catalog.ts";
import { dateInputToIso, isoToDateInput } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useCreatePrinter, usePatchPrinter, usePrinter } from "../../lib/printers.ts";
import { useTagEditor } from "../../lib/tags.ts";
import {
  CatalogAddDialog,
  ModelPicker,
  PrintProfileFields,
  printProfileBody,
} from "./CatalogForms.tsx";
import { CostFields, readCostFields } from "./CostFields.tsx";
import { useStateLabel } from "./StateBadge.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const orNull = (v: string) => v || null;
const date = (v: string) => (v ? dateInputToIso(v) : null);
const int = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);

/** Create (no `printer`) or edit. Uncontrolled inputs, read from FormData on submit. */
function PrinterForm({ printer }: { printer?: Printer }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stateLabel = useStateLabel();
  const prefs = usePreferences().data?.values;
  const create = useCreatePrinter();
  const patch = usePatchPrinter(printer?.id ?? "");
  const save = printer ? patch : create;
  const tags = useTagEditor("printer", printer?.id);
  const states = prefs?.printerStates ?? [];
  const models = useModelInfo();
  const power = useRef<HTMLInputElement>(null);
  const [modelId, setModelId] = useState(printer?.modelId);
  const [printProfileId, setPrintProfileId] = useState(printer?.printProfileId ?? "");
  const [addProfile, setAddProfile] = useState(false);
  const printProfiles = usePrintProfiles().data ?? [];
  const forModel = (p: PrintProfile) => !!modelId && p.printerModelId === modelId;

  const pickModel = (v: string, watts = models.get(v)?.model.powerW) => {
    setModelId(v);
    // A new model's typical power fills Power, unless the user typed one.
    if (power.current && !power.current.value && watts != null) power.current.value = String(watts);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: PrinterInput = {
      number: text(f, "number") ? Number(text(f, "number")) : undefined,
      name: text(f, "name"),
      modelId: text(f, "modelId"),
      serial: orNull(text(f, "serial")),
      state: text(f, "state"),
      powerW: int(text(f, "powerW")),
      purchasedAt: date(text(f, "purchasedAt")),
      purchasePrice: int(text(f, "purchasePrice"), 100),
      warrantyEndsAt: date(text(f, "warrantyEndsAt")),
      warrantyNotes: orNull(text(f, "warrantyNotes")),
      printProfileId: orNull(text(f, "printProfileId")),
      ...readCostFields(f),
    };
    // mutateAsync, not mutate's onSuccess: the save refetches the row and the edit page remounts
    // this form (key=updatedAt), which drops mutate-level callbacks.
    save
      .mutateAsync(body)
      .then(async (saved) => {
        const { id } = saved as Printer;
        await tags.persist(id);
        navigate({ to: "/printers/$id", params: { id } });
      })
      .catch(() => {}); // errors show via save.error
  };

  return (
    <>
      <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
        <FormField
          label={t("printers:form.number")}
          hint={printer ? undefined : t("printers:form.numberHint")}
        >
          {(p) => (
            <input
              {...p}
              name="number"
              type="number"
              min={1}
              step={1}
              className={inputClass}
              defaultValue={printer?.number}
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
              defaultValue={printer?.name}
            />
          )}
        </FormField>
        <FormField label={t("printers:form.model")}>
          {(p) => (
            <ModelPicker
              {...p}
              name="modelId"
              required
              defaultValue={printer?.modelId}
              onChange={(v, added) => pickModel(v, added?.powerW)}
            />
          )}
        </FormField>
        <FormField
          label={t("printers:form.printProfile")}
          hint={t("printers:form.printProfileHint")}
        >
          {(p) => (
            <PickerWithAdd
              label={t("printers:catalog.printProfiles.add")}
              onAdd={() => setAddProfile(true)}
            >
              <Combobox
                // Remount once the options arrive: an uncontrolled picker only applies defaultValue on mount.
                key={printProfiles.length}
                {...p}
                name="printProfileId"
                defaultValue={printProfileId}
                onChange={setPrintProfileId}
                options={[
                  { value: "", label: t("printers:form.printProfileNone") },
                  ...[
                    ...printProfiles.filter(forModel),
                    ...printProfiles.filter((x) => !forModel(x)),
                  ].map((x) => ({
                    value: x.id,
                    label: x.name,
                    group: forModel(x)
                      ? t("printers:form.printProfileForModel")
                      : t("printers:form.printProfileOther"),
                  })),
                ]}
              />
            </PickerWithAdd>
          )}
        </FormField>
        <FormField label={t("printers:form.serial")}>
          {(p) => (
            <input
              {...p}
              name="serial"
              className={inputClass}
              defaultValue={printer?.serial ?? ""}
            />
          )}
        </FormField>
        <FormField label={t("printers:form.state")}>
          {(p) => (
            <Combobox
              {...p}
              name="state"
              defaultValue={printer?.state ?? states[0]}
              // a state since removed from Settings stays selectable on printers that have it
              options={[...new Set([...states, ...(printer ? [printer.state] : [])])].map((s) => ({
                value: s,
                label: stateLabel(s),
              }))}
            />
          )}
        </FormField>
        <FormField label={t("printers:form.power")} hint={t("printers:form.powerHint")}>
          {(p) => (
            <input
              {...p}
              ref={power}
              name="powerW"
              type="number"
              min={0}
              step={1}
              className={inputClass}
              defaultValue={printer?.powerW ?? ""}
            />
          )}
        </FormField>
        <FormField label={t("printers:form.purchasedAt")}>
          {(p) => (
            <DateInput
              {...p}
              name="purchasedAt"
              className={inputClass}
              defaultValue={isoToDateInput(printer?.purchasedAt ?? null)}
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
              defaultValue={printer?.purchasePrice == null ? "" : printer.purchasePrice / 100}
            />
          )}
        </FormField>
        <CostFields values={printer} kind="printer" />
        <FormField label={t("printers:form.warrantyEndsAt")}>
          {(p) => (
            <DateInput
              {...p}
              name="warrantyEndsAt"
              className={inputClass}
              defaultValue={isoToDateInput(printer?.warrantyEndsAt ?? null)}
            />
          )}
        </FormField>
        <FormField label={t("printers:form.warrantyNotes")}>
          {(p) => (
            <textarea
              {...p}
              name="warrantyNotes"
              className={`${inputClass} h-20 py-2`}
              defaultValue={printer?.warrantyNotes ?? ""}
            />
          )}
        </FormField>
        <TagPicker value={tags.value} onChange={tags.onChange} />
        {save.isError && (
          <p role="alert" className="text-bad">
            {t(isConflict(save.error) ? "printers:form.numberTaken" : "printers:form.saveError")}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {t("printers:form.save")}
          </Button>
          <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
      <CatalogAddDialog
        kind="print-profiles"
        open={addProfile}
        title={t("printers:catalog.printProfiles.addTitle")}
        toBody={printProfileBody}
        onClose={() => setAddProfile(false)}
        onSaved={(pp) => setPrintProfileId(pp.id)}
      >
        <PrintProfileFields modelId={modelId} />
      </CatalogAddDialog>
    </>
  );
}

export function PrinterCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("printers:form.addTitle")} backTo={{ to: "/printers" }} />
      <PrinterForm />
    </>
  );
}

export function PrinterEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, isError } = usePrinter(id);
  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("printers:detail.notFound")}
      </p>
    );
  if (!data) return null;
  return (
    <>
      <PageHeader
        title={t("printers:form.editTitle")}
        backTo={{ to: "/printers/$id", params: { id } }}
      />
      <PrinterForm key={data.updatedAt} printer={data} />
    </>
  );
}
