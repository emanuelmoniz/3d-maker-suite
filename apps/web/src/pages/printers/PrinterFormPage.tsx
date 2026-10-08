import type { Printer, PrinterInput } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { dateInputToIso, isoToDateInput } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useCreatePrinter, usePatchPrinter, usePrinter } from "../../lib/printers.ts";
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
  const states = prefs?.printerStates ?? [];

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: PrinterInput = {
      name: text(f, "name"),
      brand: text(f, "brand"),
      model: text(f, "model"),
      serial: orNull(text(f, "serial")),
      state: text(f, "state"),
      powerW: int(text(f, "powerW")),
      purchasedAt: date(text(f, "purchasedAt")),
      purchasePrice: int(text(f, "purchasePrice"), 100),
      warrantyEndsAt: date(text(f, "warrantyEndsAt")),
      warrantyNotes: orNull(text(f, "warrantyNotes")),
    };
    save.mutate(body, {
      onSuccess: (saved) =>
        navigate({ to: "/printers/$id", params: { id: (saved as Printer).id } }),
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      <FormField label={t("printers:form.name")}>
        {(p) => (
          <input {...p} name="name" required className={inputClass} defaultValue={printer?.name} />
        )}
      </FormField>
      <FormField label={t("printers:form.brand")}>
        {(p) => (
          <input
            {...p}
            name="brand"
            required
            className={inputClass}
            defaultValue={printer?.brand}
          />
        )}
      </FormField>
      <FormField label={t("printers:form.model")}>
        {(p) => (
          <input
            {...p}
            name="model"
            required
            className={inputClass}
            defaultValue={printer?.model}
          />
        )}
      </FormField>
      <FormField label={t("printers:form.serial")}>
        {(p) => (
          <input {...p} name="serial" className={inputClass} defaultValue={printer?.serial ?? ""} />
        )}
      </FormField>
      <FormField label={t("printers:form.state")}>
        {(p) => (
          <select
            {...p}
            name="state"
            className={inputClass}
            defaultValue={printer?.state ?? states[0]}
          >
            {/* a state since removed from Settings stays selectable on printers that have it */}
            {[...new Set([...states, ...(printer ? [printer.state] : [])])].map((s) => (
              <option key={s} value={s}>
                {stateLabel(s)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label={t("printers:form.power")} hint={t("printers:form.powerHint")}>
        {(p) => (
          <input
            {...p}
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
          <input
            {...p}
            name="purchasedAt"
            type="date"
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
      <FormField label={t("printers:form.warrantyEndsAt")}>
        {(p) => (
          <input
            {...p}
            name="warrantyEndsAt"
            type="date"
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
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("printers:form.saveError")}
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

export function PrinterCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("printers:form.addTitle")} />
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
      <PageHeader title={t("printers:form.editTitle")} />
      <PrinterForm key={data.updatedAt} printer={data} />
    </>
  );
}
