import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { api } from "../../lib/api.ts";
import { useCan } from "../../lib/auth.ts";
import { formatDateTime, formatMegabytes } from "../../lib/format.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";

type Backup = { name: string; size: number; createdAt: string; auto: boolean; versions: boolean };
const KEY = ["backups"];

export function BackupSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const prefs = usePreferences().data?.values;
  const save = useSavePreferences();
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => api<Backup[]>("GET", "/api/backups"),
    enabled: useCan("admin"),
  });
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
        <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2 focus-within:outline-2">
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
                  {formatMegabytes(b.size)}
                  {b.auto ? ` · ${t("settings:backup.automatic")}` : ""}
                  {b.versions ? ` · ${t("settings:backup.withVersions")}` : ""}
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
