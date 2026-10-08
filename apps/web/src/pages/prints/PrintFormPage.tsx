import type { PrintDetail, PrintInput } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagPicker } from "../../components/TagPicker.tsx";
import { filamentLabel, useProfiles, useSpools } from "../../lib/filament.ts";
import { formatWeight } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { usePrinters } from "../../lib/printers.ts";
import { useCreatePrint, usePatchPrint, usePrint } from "../../lib/prints.ts";
import { useTagEditor } from "../../lib/tags.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const OUTCOMES = {
  success: "prints:outcomes.success",
  failed: "prints:outcomes.failed",
  cancelled: "prints:outcomes.cancelled",
} as const;

// <input type="datetime-local"> works in local time; the API stores UTC.
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

type Row = { key: number; spoolId: string; grams: string };

function PrintForm({ print }: { print?: PrintDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const spools = useSpools().data?.items ?? [];
  const profiles = useProfiles().data?.items ?? [];
  const reasons = usePreferences().data?.values.failureReasons ?? [];
  const create = useCreatePrint();
  const patch = usePatchPrint(print?.id ?? "");
  const save = print ? patch : create;
  const tags = useTagEditor("print", print?.id);
  const [outcome, setOutcome] = useState<string>(print?.outcome ?? "success");
  const [rows, setRows] = useState<Row[]>(
    (print?.usages ?? []).map((u, key) => ({
      key,
      spoolId: u.spoolId ?? "",
      grams: String(u.grams),
    })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const setRow = (key: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const spoolLabel = (id: string) => {
    const s = spools.find((x) => x.id === id);
    return t("prints:form.spoolOption", {
      filament: filamentLabel(profiles.find((p) => p.id === s?.profileId)),
      weight: formatWeight(s?.remainingGrams ?? 0),
    });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const hours = Number(text(f, "hours") || 0);
    const minutes = Number(text(f, "minutes") || 0);
    const body: PrintInput = {
      printerId: text(f, "printer"),
      title: text(f, "title"),
      startedAt: new Date(text(f, "startedAt")).toISOString(),
      durationSec: hours || minutes ? Math.round(hours * 3600 + minutes * 60) : null,
      outcome: outcome as PrintInput["outcome"],
      failureReason: outcome === "success" ? null : text(f, "failureReason") || null,
      notes: text(f, "notes") || null,
      energyWh: text(f, "energy") ? Number(text(f, "energy")) : null,
      usages: rows
        .filter((r) => r.spoolId && Number(r.grams) > 0)
        .map((r, slot) => ({ spoolId: r.spoolId, grams: Number(r.grams), slot })),
    };
    save.mutate(body, {
      onSuccess: async (saved) => {
        await tags.persist((saved as PrintDetail).id);
        navigate({ to: "/prints" });
      },
    });
  };

  const dur = print?.durationSec ?? 0;
  const hasDur = print?.durationSec != null;
  const reasonOptions = [
    ...new Set([...reasons, ...(print?.failureReason ? [print.failureReason] : [])]),
  ];
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      <FormField label={t("prints:form.title")}>
        {(p) => (
          <input {...p} name="title" required className={inputClass} defaultValue={print?.title} />
        )}
      </FormField>
      <FormField label={t("prints:form.printer")}>
        {(p) => (
          <select
            {...p}
            name="printer"
            required
            className={inputClass}
            defaultValue={print?.printerId}
          >
            {printers.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label={t("prints:form.startedAt")}>
        {(p) => (
          <input
            {...p}
            name="startedAt"
            type="datetime-local"
            required
            className={inputClass}
            defaultValue={toLocalInput(print?.startedAt ?? new Date().toISOString())}
          />
        )}
      </FormField>
      <fieldset className="grid grid-cols-2 gap-4">
        <legend className="mb-1.5 font-medium">{t("prints:form.duration")}</legend>
        <FormField label={t("prints:form.hours")}>
          {(p) => (
            <input
              {...p}
              name="hours"
              type="number"
              min={0}
              step={1}
              className={inputClass}
              defaultValue={hasDur ? Math.floor(dur / 3600) : ""}
            />
          )}
        </FormField>
        <FormField label={t("prints:form.minutes")}>
          {(p) => (
            <input
              {...p}
              name="minutes"
              type="number"
              min={0}
              max={59}
              step={1}
              className={inputClass}
              defaultValue={hasDur ? Math.floor((dur % 3600) / 60) : ""}
            />
          )}
        </FormField>
      </fieldset>
      <FormField label={t("prints:form.outcome")}>
        {(p) => (
          <select
            {...p}
            className={inputClass}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            {Object.entries(OUTCOMES).map(([k, key]) => (
              <option key={k} value={k}>
                {t(key)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      {outcome !== "success" && (
        <FormField label={t("prints:form.failureReason")}>
          {(p) => (
            <select
              {...p}
              name="failureReason"
              className={inputClass}
              defaultValue={print?.failureReason ?? ""}
            >
              <option value="">{t("prints:form.noReason")}</option>
              {reasonOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
      <fieldset className="grid gap-3">
        <legend className="font-medium">{t("prints:form.filament")}</legend>
        <p className="text-muted">{t("prints:form.filamentHint")}</p>
        {rows.map((r) => (
          <div key={r.key} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <FormField label={t("prints:form.spool")}>
                {(p) => (
                  <select
                    {...p}
                    required
                    className={inputClass}
                    value={r.spoolId}
                    onChange={(e) => setRow(r.key, { spoolId: e.target.value })}
                  >
                    <option value="" />
                    {spools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {spoolLabel(s.id)}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
            <div className="w-24">
              <FormField label={t("prints:form.grams")}>
                {(p) => (
                  <input
                    {...p}
                    required
                    type="number"
                    min={0.1}
                    step={0.1}
                    className={inputClass}
                    value={r.grams}
                    onChange={(e) => setRow(r.key, { grams: e.target.value })}
                  />
                )}
              </FormField>
            </div>
            <Button
              aria-label={t("prints:form.removeSpool")}
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button
            onClick={() => {
              setRows((rs) => [...rs, { key: nextKey, spoolId: "", grams: "" }]);
              setNextKey(nextKey + 1);
            }}
          >
            <Plus className="size-4" aria-hidden />
            {t("prints:form.addSpool")}
          </Button>
        </div>
      </fieldset>
      <FormField label={t("prints:form.energy")} hint={t("prints:form.energyHint")}>
        {(p) => (
          <input
            {...p}
            name="energy"
            type="number"
            min={0}
            step="any"
            className={inputClass}
            defaultValue={print?.energySource === "measured" ? (print.energyWh ?? "") : ""}
          />
        )}
      </FormField>
      <TagPicker value={tags.value} onChange={tags.onChange} />
      <FormField label={t("prints:form.notes")}>
        {(p) => (
          <textarea
            {...p}
            name="notes"
            className={`${inputClass} h-24 py-2`}
            defaultValue={print?.notes ?? ""}
          />
        )}
      </FormField>
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("prints:form.error")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending || !printers.length}>
          {t("prints:form.save")}
        </Button>
        <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}

export function PrintCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("prints:form.addTitle")} />
      <PrintForm />
    </>
  );
}

export function PrintEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data } = usePrint(id);
  return (
    <>
      <PageHeader title={t("prints:form.editTitle")} />
      {/* key: the form is uncontrolled, so remount when the saved print arrives */}
      {data && <PrintForm key={data.updatedAt} print={data} />}
    </>
  );
}
