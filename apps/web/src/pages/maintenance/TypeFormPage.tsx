import type { MaintenanceTarget, MaintenanceType } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SearchPicker } from "../../components/SearchPicker.tsx";
import { accessoryName, useAccessories, useAccessoryTypes } from "../../lib/accessories.ts";
import { useModelInfo } from "../../lib/catalog.ts";
import { useCreateType, useMaintenanceType, usePatchType } from "../../lib/maintenance.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { printerName, usePrinters } from "../../lib/printers.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);
const TARGETS = {
  printer: "maintenance:types.targets.printer",
  accessory: "maintenance:types.targets.accessory",
} as const;

function TypeForm({ type }: { type?: MaintenanceType }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateType();
  const patch = usePatchType();
  const save = type ? patch : create;
  const [target, setTarget] = useState<MaintenanceTarget>(type?.target ?? "printer");
  const [modelIds, setModelIds] = useState(type?.appliesToModelIds ?? []);
  const [printerIds, setPrinterIds] = useState(type?.appliesToPrinterIds ?? []);
  const [accessoryTypes, setAccessoryTypes] = useState(type?.appliesToAccessoryTypes ?? []);
  const [accessoryIds, setAccessoryIds] = useState(type?.appliesToAccessoryIds ?? []);
  const prefs = usePreferences().data?.values;
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const accessories = useAccessories().data?.items ?? [];
  const types = useAccessoryTypes().data ?? [];
  const models = [...useModelInfo().entries()].sort(([, a], [, b]) =>
    a.label.localeCompare(b.label),
  );
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const forPrinters = target === "printer";
    const body = {
      name: text(f, "name"),
      description: text(f, "description") || null,
      docUrl: text(f, "docUrl") || null,
      intervalSec: num(text(f, "hours"), 3600),
      intervalPrints: num(text(f, "prints")),
      intervalDays: num(text(f, "days")),
      warnLeadDays: num(text(f, "leadDays")),
      warnLeadHours: num(text(f, "leadHours")),
      warnLeadPrints: num(text(f, "leadPrints")),
      // On is the default, so only "off" is stored.
      warnEnabled: f.has("warnEnabled") ? null : false,
      errorEnabled: f.has("errorEnabled") ? null : false,
      target,
      // The other target's lists are cleared, so a switched type keeps no stale scope.
      appliesToModelIds: forPrinters ? modelIds : [],
      appliesToPrinterIds: forPrinters ? printerIds : [],
      appliesToAccessoryTypes: forPrinters ? [] : accessoryTypes,
      appliesToAccessoryIds: forPrinters ? [] : accessoryIds,
    };
    if (type)
      patch.mutate(
        { id: type.id, patch: body },
        { onSuccess: () => navigate({ to: "/maintenance/types/$id", params: { id: type.id } }) },
      );
    else create.mutate(body, { onSuccess: () => navigate({ to: "/maintenance" }) });
  };
  const interval = (name: string, label: string, value: number | null | undefined, min = 1) => (
    <FormField label={t(label)}>
      {(p) => (
        <input
          {...p}
          name={name}
          type="number"
          min={min}
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
        <legend className="mb-3 text-muted">{t("maintenance:types.intervalHint")}</legend>
        {interval("hours", "maintenance:types.hours", type?.intervalSec && type.intervalSec / 3600)}
        {interval("prints", "maintenance:types.prints", type?.intervalPrints)}
        {interval("days", "maintenance:types.days", type?.intervalDays)}
      </fieldset>
      <fieldset className="grid gap-4">
        <legend className="mb-3 text-muted">
          {t("maintenance:types.alertsHint", {
            days: prefs?.maintenanceLeadDays,
            hours: prefs?.maintenanceLeadHours,
            prints: prefs?.maintenanceLeadPrints,
          })}
        </legend>
        {interval("leadDays", "maintenance:types.leadDays", type?.warnLeadDays, 0)}
        {interval("leadHours", "maintenance:types.leadHours", type?.warnLeadHours, 0)}
        {interval("leadPrints", "maintenance:types.leadPrints", type?.warnLeadPrints, 0)}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="warnEnabled" defaultChecked={type?.warnEnabled !== false} />
          {t("maintenance:types.warnEnabled")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="errorEnabled"
            defaultChecked={type?.errorEnabled !== false}
          />
          {t("maintenance:types.errorEnabled")}
        </label>
      </fieldset>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-2 font-medium">{t("maintenance:types.target")}</legend>
        {(Object.keys(TARGETS) as MaintenanceTarget[]).map((v) => (
          <label key={v} className="flex items-center gap-2">
            <input
              type="radio"
              name="target"
              value={v}
              checked={target === v}
              onChange={() => setTarget(v)}
            />
            {t(TARGETS[v])}
          </label>
        ))}
      </fieldset>
      {target === "printer" ? (
        <>
          <SearchPicker
            label={t("maintenance:types.model")}
            options={models.map(([id, m]) => ({ id, label: m.label }))}
            value={modelIds}
            onChange={setModelIds}
          />
          {printers.length > 0 && (
            <SearchPicker
              label={t("maintenance:types.printers")}
              options={printers.map((p) => ({ id: p.id, label: printerName(t, p) }))}
              value={printerIds}
              onChange={setPrinterIds}
            />
          )}
          <p className="text-muted">{t("maintenance:types.modelHint")}</p>
        </>
      ) : (
        <>
          <SearchPicker
            label={t("maintenance:types.accessoryTypes")}
            options={types.map((v) => ({ id: v, label: v }))}
            value={accessoryTypes}
            onChange={setAccessoryTypes}
          />
          {accessories.length > 0 && (
            <SearchPicker
              label={t("maintenance:types.accessories")}
              options={accessories.map((a) => ({ id: a.id, label: accessoryName(t, a) }))}
              value={accessoryIds}
              onChange={setAccessoryIds}
            />
          )}
          <p className="text-muted">{t("maintenance:types.accessoryHint")}</p>
        </>
      )}
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
