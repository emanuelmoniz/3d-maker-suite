import {
  type MaintenanceDueItem,
  type MaintenanceType,
  maintenanceTypeFilters,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { dateInputToIso, formatDate, formatDuration, formatNumber } from "../../lib/format.ts";
import { useListPage, useUrlListQuery } from "../../lib/list.ts";
import { useDue, useLogDone } from "../../lib/maintenance.ts";
import { usePreferences } from "../../lib/preferences.ts";

const STATUS = {
  ok: "maintenance:due.status.ok",
  upcoming: "maintenance:due.status.upcoming",
  overdue: "maintenance:due.status.overdue",
} as const;
const TONE = {
  ok: "bg-ok/15 text-ok",
  upcoming: "bg-warn/15 text-warn",
  overdue: "bg-bad/15 text-bad",
};
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);

function useDueText() {
  const { t } = useTranslation();
  return (i: MaintenanceDueItem) => {
    const late = i.status === "overdue";
    const sec = formatDuration(i.remainingSec ?? 0);
    const prints = Math.abs(i.remainingPrints ?? 0);
    const date = formatDate(i.dueAt ?? "");
    switch (i.dueBy) {
      case "hours":
        return late
          ? t("maintenance:due.late.hours", { value: sec })
          : t("maintenance:due.left.hours", { value: sec });
      case "count":
        return late
          ? t("maintenance:due.late.count", { count: prints })
          : t("maintenance:due.left.count", { count: prints });
      case "days":
        return late
          ? t("maintenance:due.late.days", { date })
          : t("maintenance:due.left.days", { date });
      default:
        return t("maintenance:due.noInterval");
    }
  };
}

/** Modal form to log a task as done. Native <dialog> like ConfirmDialog. */
function LogDialog({ item, onClose }: { item: MaintenanceDueItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const currency = usePreferences().data?.values.currency ?? "";
  const log = useLogDone();
  useEffect(() => {
    const d = ref.current;
    if (!d || !!item === d.open) return;
    if (item) d.showModal();
    else d.close();
  }, [item]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!item) return;
    const f = new FormData(e.currentTarget);
    const date = text(f, "doneAt");
    log.mutate(
      {
        printerId: item.printerId,
        typeId: item.typeId,
        // today keeps the exact time, so prints made earlier today still count
        doneAt:
          date && date !== new Date().toISOString().slice(0, 10) ? dateInputToIso(date) : undefined,
        cost: num(text(f, "cost"), 100),
        notes: text(f, "notes") || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,26rem)] rounded-lg border border-border bg-surface p-5 text-fg"
    >
      {item && (
        <form key={`${item.printerId}:${item.typeId}`} onSubmit={onSubmit} className="grid gap-4">
          <div>
            <h2 className="text-base font-semibold">{t("maintenance:log.title")}</h2>
            <p className="mt-1 text-muted">
              {t("maintenance:log.summary", { task: item.typeName, printer: item.printerName })}
            </p>
          </div>
          <FormField label={t("maintenance:log.date")}>
            {(p) => (
              <input
                {...p}
                name="doneAt"
                type="date"
                className={inputClass}
                max={new Date().toISOString().slice(0, 10)}
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            )}
          </FormField>
          <FormField label={`${t("maintenance:log.cost")} (${currency})`}>
            {(p) => (
              <input {...p} name="cost" type="number" min={0} step={0.01} className={inputClass} />
            )}
          </FormField>
          <FormField label={t("maintenance:log.notes")}>
            {(p) => <textarea {...p} name="notes" className={`${inputClass} h-20 py-2`} />}
          </FormField>
          {log.isError && (
            <p role="alert" className="text-bad">
              {t("maintenance:log.error")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={log.isPending}>
              {t("maintenance:log.save")}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function MaintenancePage() {
  const { t, i18n } = useTranslation();
  const due = useDue();
  const [query, setQuery] = useUrlListQuery();
  const types = useListPage<MaintenanceType>(
    ["maintenance", "types"],
    "/api/maintenance/types",
    query,
  );
  const dueText = useDueText();
  const [logging, setLogging] = useState<MaintenanceDueItem | null>(null);
  const list = new Intl.ListFormat(i18n.language, { type: "unit", style: "narrow" });
  const intervals = (m: MaintenanceType) =>
    list.format(
      [
        m.intervalSec !== null &&
          t("maintenance:types.intervalHours", { value: formatNumber(m.intervalSec / 3600) }),
        m.intervalPrints !== null &&
          t("maintenance:types.intervalPrints", { count: m.intervalPrints }),
        m.intervalDays !== null && t("maintenance:types.intervalDays", { count: m.intervalDays }),
      ].filter((v): v is string => !!v),
    );

  return (
    <>
      <PageHeader
        title={t("nav:items.maintenance.label")}
        description={t("nav:items.maintenance.description")}
      />
      {(due.isError || types.isError) && (
        <p role="alert" className="text-bad">
          {t("maintenance:loadError")}
        </p>
      )}
      <div className="grid gap-8">
        <section>
          <h2 className="mb-3 text-base font-semibold">{t("maintenance:due.title")}</h2>
          {due.data && !due.data.length ? (
            <EmptyState
              icon={Wrench}
              title={t("maintenance:due.emptyTitle")}
              description={t("maintenance:due.emptyBody")}
            />
          ) : (
            due.data && (
              <DataTable
                label={t("maintenance:due.table")}
                rows={due.data}
                rowKey={(i) => `${i.printerId}:${i.typeId}`}
                columns={[
                  {
                    id: "printer",
                    header: t("maintenance:due.columns.printer"),
                    cell: (i) => (
                      <Link
                        to="/printers/$id"
                        params={{ id: i.printerId }}
                        className="font-medium hover:underline"
                      >
                        {i.printerName}
                      </Link>
                    ),
                    sortValue: (i) => i.printerName.toLowerCase(),
                  },
                  {
                    id: "task",
                    header: t("maintenance:due.columns.task"),
                    cell: (i) => (
                      <Link
                        to="/maintenance/types/$id"
                        params={{ id: i.typeId }}
                        className="hover:underline"
                      >
                        {i.typeName}
                      </Link>
                    ),
                    sortValue: (i) => i.typeName.toLowerCase(),
                  },
                  {
                    id: "last",
                    header: t("maintenance:due.columns.lastDone"),
                    cell: (i) =>
                      i.lastDoneAt ? formatDate(i.lastDoneAt) : t("maintenance:due.never"),
                    sortValue: (i) => i.lastDoneAt ?? "",
                  },
                  {
                    id: "due",
                    header: t("maintenance:due.columns.due"),
                    cell: dueText,
                    sortValue: (i) => -i.progress,
                  },
                  {
                    id: "status",
                    header: t("maintenance:due.columns.status"),
                    cell: (i) => (
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE[i.status]}`}
                      >
                        {t(STATUS[i.status])}
                      </span>
                    ),
                    sortValue: (i) => -i.progress,
                  },
                  {
                    id: "action",
                    header: "",
                    cell: (i) => (
                      <Button onClick={() => setLogging(i)}>{t("maintenance:due.logDone")}</Button>
                    ),
                  },
                ]}
              />
            )
          )}
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("maintenance:types.title")}</h2>
            <Link
              to="/maintenance/new"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden />
              {t("maintenance:types.add")}
            </Link>
          </div>
          {types.data && (
            <DataTable
              label={t("maintenance:types.table")}
              rows={types.data.items}
              rowKey={(m) => m.id}
              server={{
                query,
                onQueryChange: setQuery,
                total: types.data.total,
                filters: maintenanceTypeFilters,
                archivable: true,
              }}
              columns={[
                {
                  id: "name",
                  header: t("maintenance:types.name"),
                  cell: (m) => (
                    <>
                      <Link
                        to="/maintenance/types/$id"
                        params={{ id: m.id }}
                        className="font-medium hover:underline"
                      >
                        {m.name}
                      </Link>
                      {m.description && <span className="block text-muted">{m.description}</span>}
                    </>
                  ),
                  sort: "name",
                  filter: "name",
                },
                {
                  id: "interval",
                  header: t("maintenance:types.interval"),
                  cell: intervals,
                },
                {
                  id: "model",
                  header: t("maintenance:types.model"),
                  cell: (m) => m.appliesToModel ?? t("maintenance:types.allModels"),
                  sort: "appliesToModel",
                  filter: "appliesToModel",
                },
              ]}
            />
          )}
        </section>
      </div>
      <LogDialog item={logging} onClose={() => setLogging(null)} />
    </>
  );
}
