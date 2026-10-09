import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useCreateType } from "../../lib/maintenance.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);

function TypeForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateType();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    create.mutate(
      {
        name: text(f, "name"),
        description: text(f, "description") || null,
        intervalSec: num(text(f, "hours"), 3600),
        intervalPrints: num(text(f, "prints")),
        intervalDays: num(text(f, "days")),
        appliesToModel: text(f, "model") || null,
      },
      { onSuccess: () => navigate({ to: "/maintenance" }) },
    );
  };
  const interval = (name: string, label: string) => (
    <FormField label={t(label)}>
      {(p) => <input {...p} name={name} type="number" min={1} step={1} className={inputClass} />}
    </FormField>
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      <FormField label={t("maintenance:types.name")}>
        {(p) => <input {...p} name="name" required className={inputClass} />}
      </FormField>
      <FormField label={t("maintenance:types.description")}>
        {(p) => <input {...p} name="description" className={inputClass} />}
      </FormField>
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-muted">{t("maintenance:types.intervalHint")}</legend>
        {interval("hours", "maintenance:types.hours")}
        {interval("prints", "maintenance:types.prints")}
        {interval("days", "maintenance:types.days")}
      </fieldset>
      <FormField label={t("maintenance:types.model")} hint={t("maintenance:types.modelHint")}>
        {(p) => <input {...p} name="model" className={inputClass} />}
      </FormField>
      {create.isError && (
        <p role="alert" className="text-bad">
          {t("maintenance:types.error")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {t("maintenance:types.save")}
        </Button>
        <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}

export function TypeCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("maintenance:types.addTitle")} backTo={{ to: "/maintenance" }} />
      <TypeForm />
    </>
  );
}
