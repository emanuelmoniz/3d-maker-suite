import type { MaintenanceTask } from "@3d-maker-suite/core";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Section } from "../../components/Section.tsx";
import { useCan, useMe } from "../../lib/auth.ts";
import {
  dateInputToIso,
  formatCurrency,
  formatDate,
  formatNumber,
  isoToDateInput,
} from "../../lib/format.ts";
import { useDeleteTask, usePatchTask, useTaskHistory } from "../../lib/maintenance.ts";
import { usePreferences } from "../../lib/preferences.ts";

const none = "—";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The records logged for a printer, an accessory or one task, newest first. Write fixes or
 * deletes the ones the user logged, Manage any (the server checks the same).
 */
export function MaintenanceHistory({
  printerId,
  accessoryId,
  typeId,
}: {
  printerId?: string;
  accessoryId?: string;
  typeId?: string;
}) {
  const { t } = useTranslation();
  const history = useTaskHistory({ printerId, accessoryId, typeId });
  const patch = usePatchTask();
  const remove = useDeleteTask();
  const me = useMe();
  const canWrite = useCan("maintenance");
  const canManage = useCan("maintenance", "manage");
  const currency = usePreferences().data?.values.currency ?? "EUR";
  const [editing, setEditing] = useState<MaintenanceTask | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // No accounts yet (`me` is empty): anyone may.
  const mayChange = (r: MaintenanceTask) => canManage || (canWrite && (!me || r.doneBy === me.id));
  const rows = history.data?.items ?? [];

  const columns: Column<MaintenanceTask>[] = [
    {
      id: "date",
      header: t("maintenance:history.columns.date"),
      cell: (r) => formatDate(r.doneAt),
    },
    ...(typeId
      ? []
      : [
          {
            id: "task",
            header: t("maintenance:history.columns.task"),
            cell: (r: MaintenanceTask) => r.typeName ?? none,
          },
        ]),
    {
      id: "doneBy",
      header: t("maintenance:history.columns.doneBy"),
      cell: (r) => r.doneByName ?? none,
    },
    {
      id: "cost",
      header: t("maintenance:history.columns.cost"),
      numeric: true,
      cell: (r) => (r.cost === null ? none : formatCurrency(r.cost / 100, currency)),
    },
    {
      id: "usage",
      header: t("maintenance:history.columns.usage"),
      cell: (r) =>
        t("maintenance:history.usage", {
          hours: formatNumber(r.printerRuntimeSecAt / 3600, { maximumFractionDigits: 1 }),
          prints: formatNumber(r.printerPrintsAt),
        }),
    },
    {
      id: "notes",
      header: t("maintenance:history.columns.notes"),
      cell: (r) => <span className="wrap-anywhere">{r.notes ?? none}</span>,
    },
    {
      id: "actions",
      header: t("maintenance:history.columns.actions"),
      cell: (r) =>
        mayChange(r) && (
          <span className="flex gap-1">
            <Button
              variant="ghost"
              className="size-9 px-0"
              title={t("maintenance:history.edit")}
              aria-label={t("maintenance:history.edit")}
              onClick={() => setEditing(r)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              className="size-9 px-0"
              title={t("maintenance:history.delete")}
              aria-label={t("maintenance:history.delete")}
              onClick={() => setDeleting(r.id)}
            >
              <Trash2 className="size-4 text-bad" />
            </Button>
          </span>
        ),
    },
  ];

  return (
    <Section title={t("maintenance:history.title")} id="maintenance-history">
      {history.isError && (
        <p role="alert" className="text-bad">
          {t("maintenance:loadError")}
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="mb-3 text-bad">
          {t("maintenance:history.deleteError")}
        </p>
      )}
      {history.data && !rows.length ? (
        <p className="text-muted">{t("maintenance:history.empty")}</p>
      ) : (
        history.data && (
          <DataTable
            label={t("maintenance:history.table")}
            rows={rows}
            rowKey={(r) => r.id}
            columns={columns}
          />
        )
      )}
      <FormDialog
        open={editing !== null}
        title={t("maintenance:history.editTitle")}
        error={patch.isError ? t("maintenance:history.error") : undefined}
        busy={patch.isPending}
        onCancel={() => setEditing(null)}
        onSubmit={(f) => {
          if (!editing) return;
          const date = String(f.get("doneAt") ?? "").trim();
          const cost = String(f.get("cost") ?? "").trim();
          patch.mutate(
            {
              id: editing.id,
              patch: {
                // An unchanged day keeps the exact time, so its usage doesn't move.
                ...(date && date !== isoToDateInput(editing.doneAt)
                  ? { doneAt: dateInputToIso(date) }
                  : {}),
                cost: cost ? Math.round(Number(cost) * 100) : null,
                notes: String(f.get("notes") ?? "").trim() || null,
              },
            },
            { onSuccess: () => setEditing(null) },
          );
        }}
      >
        {editing && (
          <div key={editing.id} className="grid gap-4">
            <p className="text-muted">
              {t("maintenance:history.editSummary", { task: editing.typeName ?? none })}
            </p>
            <FormField label={t("maintenance:log.date")}>
              {(p) => (
                <DateInput
                  {...p}
                  name="doneAt"
                  className={inputClass}
                  max={today()}
                  defaultValue={isoToDateInput(editing.doneAt)}
                />
              )}
            </FormField>
            <FormField label={`${t("maintenance:log.cost")} (${currency})`}>
              {(p) => (
                <input
                  {...p}
                  name="cost"
                  type="number"
                  min={0}
                  step={0.01}
                  className={inputClass}
                  defaultValue={editing.cost === null ? "" : editing.cost / 100}
                />
              )}
            </FormField>
            <FormField label={t("maintenance:log.notes")}>
              {(p) => (
                <textarea
                  {...p}
                  name="notes"
                  className={`${inputClass} h-20 py-2`}
                  defaultValue={editing.notes ?? ""}
                />
              )}
            </FormField>
          </div>
        )}
      </FormDialog>
      <ConfirmDialog
        open={deleting !== null}
        destructive
        title={t("maintenance:history.deleteTitle")}
        description={t("maintenance:history.deleteBody")}
        confirmLabel={t("maintenance:history.delete")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
          setDeleting(null);
        }}
      />
    </Section>
  );
}
