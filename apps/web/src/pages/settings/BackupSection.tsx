import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { api } from "../../lib/api.ts";
import { formatDateTime, formatNumber } from "../../lib/format.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";

type Backup = { name: string; size: number; createdAt: string; auto: boolean };
const KEY = ["backups"];

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const TABLES = [
  ["printers", "settings:backup.tables.printers"],
  ["brands", "settings:backup.tables.brands"],
  ["printer-models", "settings:backup.tables.printerModels"],
  ["machine-profiles", "settings:backup.tables.machineProfiles"],
  ["maintenance", "settings:backup.tables.maintenance"],
  ["maintenance-types", "settings:backup.tables.maintenanceTypes"],
  ["filament-brands", "settings:backup.tables.filamentBrands"],
  ["filament-materials", "settings:backup.tables.filamentMaterials"],
  ["filament-profiles", "settings:backup.tables.filamentProfiles"],
  ["spools", "settings:backup.tables.spools"],
  ["projects", "settings:backup.tables.projects"],
  ["prints", "settings:backup.tables.prints"],
  ["quotes", "settings:backup.tables.quotes"],
] as const;

const megabytes = (bytes: number) =>
  `${formatNumber(bytes / 1024 ** 2, { maximumFractionDigits: 1 })} MB`;

export function BackupSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const prefs = usePreferences().data?.values;
  const save = useSavePreferences();
  const list = useQuery({ queryKey: KEY, queryFn: () => api<Backup[]>("GET", "/api/backups") });
  const [restoring, setRestoring] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const create = useMutation({ mutationFn: () => api("POST", "/api/backups"), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (name: string) => api("DELETE", `/api/backups/${name}`),
    onSuccess: refresh,
  });
  const upload = useMutation({
    mutationFn: (file: File) =>
      api("POST", "/api/backups/upload", new Blob([file], { type: "application/zip" })),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (name: string) => api("POST", `/api/backups/${name}/restore`, { confirm: true }),
    onSettled: () => setRestoring(null),
  });

  const error = [create, remove, upload, restore].some((m) => m.isError);

  return (
    <div className="grid gap-4">
      <p className="text-muted">{t("settings:backup.hint")}</p>

      {prefs && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={prefs.backupAuto}
              onChange={(e) => save.mutate({ backupAuto: e.target.checked })}
            />
            <span className="font-medium">{t("settings:backup.auto")}</span>
          </label>
          <FormField label={t("settings:backup.keep")} hint={t("settings:backup.keepHint")}>
            {(p) => (
              <input
                {...p}
                className={inputClass}
                type="number"
                min={1}
                max={100}
                key={`keep-${prefs.backupKeep}`}
                defaultValue={prefs.backupKeep}
                onBlur={(e) => {
                  const n = e.target.valueAsNumber;
                  if (e.target.checkValidity() && n !== prefs.backupKeep)
                    save.mutate({ backupKeep: n });
                }}
              />
            )}
          </FormField>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>
          {t("settings:backup.create")}
        </Button>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2 focus-within:outline focus-within:outline-2">
          {t("settings:backup.upload")}
          <input
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-bad">
          {t("settings:backup.error")}
        </p>
      )}
      {restore.isSuccess && (
        <p role="status" className="font-medium text-ok">
          {t("settings:backup.restaged")}
        </p>
      )}

      {list.data?.length ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {list.data.map((b) => (
            <li key={b.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{formatDateTime(b.createdAt)}</div>
                <div className="text-muted">
                  {megabytes(b.size)}
                  {b.auto ? ` · ${t("settings:backup.automatic")}` : ""}
                </div>
              </div>
              <a
                className="font-medium text-accent hover:underline"
                href={`/api/backups/${b.name}`}
                download
              >
                {t("settings:backup.download")}
              </a>
              <Button onClick={() => setRestoring(b.name)}>{t("settings:backup.restore")}</Button>
              <Button variant="ghost" onClick={() => remove.mutate(b.name)}>
                {t("settings:backup.delete")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t("settings:backup.empty")}</p>
      )}

      <div className="grid gap-2 border-t border-border pt-4">
        <h3 className="font-medium">{t("settings:backup.exportTitle")}</h3>
        <p className="text-muted">{t("settings:backup.exportHint")}</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {TABLES.map(([id, label]) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span>{t(label)}</span>
              <span className="flex gap-3">
                {(["csv", "json"] as const).map((f) => (
                  <a
                    key={f}
                    className="font-medium text-accent hover:underline"
                    href={`/api/export/${id}?format=${f}`}
                    download
                  >
                    {f.toUpperCase()}
                  </a>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={restoring !== null}
        destructive
        title={t("settings:backup.confirmTitle")}
        description={t("settings:backup.confirmBody")}
        confirmLabel={t("settings:backup.restore")}
        onConfirm={() => restoring && restore.mutate(restoring)}
        onCancel={() => setRestoring(null)}
      />
    </div>
  );
}
