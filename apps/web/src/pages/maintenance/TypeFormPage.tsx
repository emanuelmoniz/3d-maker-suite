import type { MaintenanceType } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SearchPicker } from "../../components/SearchPicker.tsx";
import { useModelInfo } from "../../lib/catalog.ts";
import { useCreateType, useMaintenanceType, usePatchType } from "../../lib/maintenance.ts";
import { usePrinters } from "../../lib/printers.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);

function TypeForm({ type }: { type?: MaintenanceType }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateType();
  const patch = usePatchType();
  const save = type ? patch : create;
  const [modelIds, setModelIds] = useState(type?.appliesToModelIds ?? []);
  const [printerIds, setPrinterIds] = useState(type?.appliesToPrinterIds ?? []);
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const models = [...useModelInfo().entries()].sort(([, a], [, b]) =>
    a.label.localeCompare(b.label),
  );
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = {
      name: text(f, "name"),
      description: text(f, "description") || null,
      docUrl: text(f, "docUrl") || null,
      intervalSec: num(text(f, "hours"), 3600),
      intervalPrints: num(text(f, "prints")),
      intervalDays: num(text(f, "days")),
      appliesToModelIds: modelIds,
      appliesToPrinterIds: printerIds,
    };
    if (type)
      patch.mutate(
        { id: type.id, patch: body },
        { onSuccess: () => navigate({ to: "/maintenance/types/$id", params: { id: type.id } }) },
      );
    else create.mutate(body, { onSuccess: () => navigate({ to: "/maintenance" }) });
  };
  const interval = (name: string, label: string, value: number | null | undefined) => (
    <FormField label={t(label)}>
      {(p) => (
        <input
          {...p}
          name={name}
          type="number"
          min={1}
          step={name === "hours" ? "any" : 1}
          defaultValue={value ?? undefined}
          className={inputClass}
        />
      )}
    </FormField>
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      <FormField label={t("maintenance:types.name")}>
        {(p) => (
          <input {...p} name="name" required defaultValue={type?.name} className={inputClass} />
        )}
      </FormField>
      <FormField label={t("maintenance:types.description")}>
        {(p) => (
          <input
            {...p}
            name="description"
            defaultValue={type?.description ?? undefined}
            className={inputClass}
          />
        )}
      </FormField>
      <FormField label={t("maintenance:types.docUrl")}>
        {(p) => (
          <input
            {...p}
            name="docUrl"
            type="url"
            placeholder="https://"
            defaultValue={type?.docUrl ?? ""}
            className={inputClass}
          />
        )}
      </FormField>
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-muted">{t("maintenance:types.intervalHint")}</legend>
        {interval("hours", "maintenance:types.hours", type?.intervalSec && type.intervalSec / 3600)}
        {interval("prints", "maintenance:types.prints", type?.intervalPrints)}
        {interval("days", "maintenance:types.days", type?.intervalDays)}
      </fieldset>
      <SearchPicker
        label={t("maintenance:types.model")}
        options={models.map(([id, m]) => ({ id, label: m.label }))}
        value={modelIds}
        onChange={setModelIds}
      />
      {printers.length > 0 && (
        <SearchPicker
          label={t("maintenance:types.printers")}
          options={printers.map((p) => ({ id: p.id, label: p.name }))}
          value={printerIds}
          onChange={setPrinterIds}
        />
      )}
      <p className="text-muted">{t("maintenance:types.modelHint")}</p>
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("maintenance:types.error")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
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

export function TypeEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data } = useMaintenanceType(id);
  return (
    <>
      <PageHeader
        title={t("maintenance:types.editTitle")}
        backTo={{ to: "/maintenance/types/$id", params: { id } }}
      />
      {/* key: the form is uncontrolled, so remount when the saved type arrives */}
      {data && <TypeForm key={data.updatedAt} type={data} />}
    </>
  );
}
