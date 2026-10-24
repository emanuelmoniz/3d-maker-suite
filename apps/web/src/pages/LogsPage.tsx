import {
  LOG_LEVELS,
  LOG_MODULES,
  type LogEntry,
  type LogLevel,
  logFilters,
} from "@3d-maker-suite/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { DataTable } from "../components/DataTable.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { api } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { useListPage, useUrlListQuery } from "../lib/list.ts";
import { usePreferences } from "../lib/preferences.ts";
import { LEVEL_LABELS, MODULE_LABELS } from "./settings/LogSection.tsx";

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-muted",
  info: "",
  success: "text-ok",
  warn: "text-warn",
  error: "text-bad font-medium",
};

export function LogsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = useListPage<LogEntry>(["logs"], "/api/logs", query, 10_000);
  const active = usePreferences().data?.values.logActive;
  const [confirming, setConfirming] = useState(false);
  const clear = useMutation({
    mutationFn: () => api("DELETE", "/api/logs"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logs"] }),
  });
  const moduleLabel = (m: string) =>
    m in MODULE_LABELS ? t(MODULE_LABELS[m as keyof typeof MODULE_LABELS]) : m;

  return (
    <>
      <PageHeader
        title={t("nav:items.logs.label")}
        description={t("nav:items.logs.description")}
        actions={
          <Button variant="danger" disabled={!data?.total} onClick={() => setConfirming(true)}>
            {t("logs:clear")}
          </Button>
        }
      />
      {active === false && <p className="mb-4 text-muted">{t("logs:inactive")}</p>}
      {(isError || clear.isError) && (
        <p role="alert" className="text-bad">
          {t("logs:loadError")}
        </p>
      )}
      {data && !data.total && !Object.keys(query).length ? (
        <EmptyState
          icon={ScrollText}
          title={t("logs:emptyTitle")}
          description={t("logs:emptyBody")}
        />
      ) : (
        data && (
          <DataTable
            label={t("logs:table")}
            rows={data.items}
            rowKey={(r) => String(r.id)}
            server={{
              query,
              onQueryChange: setQuery,
              total: data.total,
              filters: logFilters,
              defaultSort: "-time",
            }}
            columns={[
              {
                id: "time",
                header: t("logs:columns.time"),
                cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.time)}</span>,
                sort: "time",
                filter: "time",
              },
              {
                id: "level",
                header: t("logs:columns.level"),
                cell: (r) => (
                  <span className={LEVEL_CLASS[r.level]}>{t(LEVEL_LABELS[r.level])}</span>
                ),
                sort: "level",
                filter: "level",
                filterOptions: LOG_LEVELS.map((l) => ({ value: l, label: t(LEVEL_LABELS[l]) })),
              },
              {
                id: "module",
                header: t("logs:columns.module"),
                cell: (r) => moduleLabel(r.module),
                sort: "module",
                filter: "module",
                filterOptions: LOG_MODULES.map((m) => ({ value: m, label: moduleLabel(m) })),
              },
              {
                id: "actor",
                header: t("logs:columns.actor"),
                cell: (r) => r.actor ?? "",
                sort: "actor",
                filter: "actor",
              },
              {
                id: "message",
                header: t("logs:columns.message"),
                cell: (r) =>
                  r.detail ? (
                    <details>
                      <summary className="cursor-pointer break-all">{r.message}</summary>
                      <pre className="mt-1 max-w-full overflow-x-auto rounded-md bg-surface-2 p-2 text-xs">
                        {JSON.stringify(r.detail, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="break-all">{r.message}</span>
                  ),
                sort: "message",
                filter: "message",
              },
            ]}
          />
        )
      )}
      <ConfirmDialog
        open={confirming}
        title={t("logs:clearTitle")}
        description={t("logs:clearConfirm")}
        confirmLabel={t("logs:clear")}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          clear.mutate();
        }}
      />
    </>
  );
}
