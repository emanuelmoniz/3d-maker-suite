import {
  type Accessory,
  accessoryFilters,
  MONITORING_FILTERS,
  monitoringKey,
  monitoringOf,
  type PrinterRow,
  printerFilters,
} from "@3d-maker-suite/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Printer as PrinterIcon, Puzzle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchivedBadge, archiveColumn } from "../../components/ArchiveActions.tsx";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { SyncButton } from "../../components/SyncButton.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { Write } from "../../components/Write.tsx";
import { accessoryName } from "../../lib/accessories.ts";
import { useModelInfo } from "../../lib/catalog.ts";
import { textLink } from "../../lib/cx.ts";
import { formatDuration, formatNumber } from "../../lib/format.ts";
import { useHasArchived, useListPage, useUrlListQuery } from "../../lib/list.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { usePrinterStatus } from "../../lib/printerStatus.ts";
import { printerName, usePrinters } from "../../lib/printers.ts";
import { useTagColumn } from "../../lib/tags.ts";
import { addClass } from "./Catalog.tsx";
import { MonitoringBadge } from "./MonitoringBadge.tsx";
import { StateBadge, useStateLabel } from "./StateBadge.tsx";

/** The label of each Monitoring filter value; literal keys so `pnpm i18n:check` sees them. */
function useMonitoringLabel() {
  const { t } = useTranslation();
  const labels: Record<(typeof MONITORING_FILTERS)[number], string> = {
    none: t("printers:monitoring.none"),
    synced: t("printers:monitoring.synced"),
    idle: t("printers:status.states.idle"),
    printing: t("printers:status.states.printing"),
    paused: t("printers:status.states.paused"),
    offline: t("printers:monitoring.offline"),
    machine_offline: t("printers:monitoring.machineOffline"),
    source_error: t("printers:monitoring.error"),
  };
  return (v: (typeof MONITORING_FILTERS)[number]) => labels[v];
}

export type PrintersTab = "printers" | "accessories";

/** Title, gear and tabs around the open tab (6.1.0 Step 24): Printers and Accessories. */
export function PrintersPage({ tab }: { tab: PrintersTab }) {
  const { t } = useTranslation();
  const addAccessory = (
    <Write can="printers" level="manage">
      <Link to="/printers/accessories/new" className={addClass}>
        <Plus className="size-4" aria-hidden />
        {t("printers:accessories.add")}
      </Link>
    </Write>
  );
  return (
    <>
      <PageHeader
        title={t("nav:items.printers.label")}
        description={t("nav:items.printers.description")}
        actions={
          <>
            {tab === "printers" ? <PrinterActions /> : addAccessory}
            <SettingsLink module="printers" />
          </>
        }
      />
      <Tabs
        label={t("printers:tabs.label")}
        items={[
          { to: "/printers", label: t("printers:tabs.printers"), exact: true },
          { to: "/printers/accessories", label: t("printers:tabs.accessories"), exact: true },
        ]}
      />
      {tab === "printers" ? <PrintersTable /> : <AccessoriesTable add={addAccessory} />}
    </>
  );
}

function PrinterActions() {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap gap-2">
      <SyncButton types={["printers"]} />
      <Write can="printers" level="manage">
        <Link to="/printers/new" className={addClass}>
          <Plus className="size-4" aria-hidden />
          {t("printers:list.add")}
        </Link>
      </Write>
    </span>
  );
}

function PrintersTable() {
  const { t } = useTranslation();
  const stateLabel = useStateLabel();
  const states = usePreferences().data?.values.printerStates ?? [];
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = useListPage<PrinterRow>(["printers", "list"], "/api/printers", query);
  const hasArchived = useHasArchived(["printers", "list"], "/api/printers");
  const tagColumn = useTagColumn<PrinterRow>("printer");
  const models = useModelInfo();
  const live = usePrinterStatus().data ?? [];
  const monitoringLabel = useMonitoringLabel();
  const queryClient = useQueryClient();
  // Sorted or filtered by Monitoring, rows never move by themselves: a change shows a hint instead.
  const byMonitoring = query.sort?.replace(/^-/, "") === "monitoring" || !!query.monitoring;
  const keysOf = (rows: PrinterRow[]) =>
    rows.map((p) => monitoringKey(monitoringOf(p.id, live, p.syncOnly))).join();
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (data) setShown(keysOf(data.items));
  }, [data]);
  const changed = byMonitoring && !!data && !!shown && keysOf(data.items) !== shown;

  return (
    <>
      {isError && (
        <p role="alert" className="text-bad">
          {t("printers:loadError")}
        </p>
      )}
      {changed && (
        <p role="status" className="mb-3 flex flex-wrap items-center gap-3 text-muted">
          {t("printers:monitoring.changed")}
          <Button onClick={() => queryClient.invalidateQueries({ queryKey: ["printers", "list"] })}>
            {t("printers:monitoring.refresh")}
          </Button>
        </p>
      )}
      {data && !data.total && !Object.keys(query).length && !hasArchived ? (
        <EmptyState
          icon={PrinterIcon}
          title={t("printers:list.emptyTitle")}
          description={t("printers:list.emptyBody")}
          action={<PrinterActions />}
        />
      ) : (
        data && (
          <DataTable
            label={t("printers:list.table")}
            rows={data.items}
            rowKey={(p) => p.id}
            server={{
              query,
              onQueryChange: setQuery,
              total: data.total,
              filters: printerFilters,
              archivable: true,
            }}
            columns={[
              {
                id: "name",
                header: t("printers:list.columns.name"),
                cell: (p) => (
                  <Link to="/printers/$id" params={{ id: p.id }} className={textLink}>
                    {printerName(t, p)}
                  </Link>
                ),
                sort: "name",
                filter: "name",
              },
              {
                id: "model",
                header: t("printers:list.columns.model"),
                cell: (p) => models.get(p.modelId)?.label,
                sort: "model",
                filter: "model",
              },
              {
                id: "state",
                header: t("printers:list.columns.state"),
                cell: (p) => <StateBadge state={p.state} />,
                sort: "state",
                filter: "state",
                filterOptions: states.map((s) => ({ value: s, label: stateLabel(s) })),
              },
              // Live badge; sort and filter use the status the server holds in memory.
              {
                id: "monitoring",
                header: t("printers:list.columns.monitoring"),
                cell: (p) => <MonitoringBadge monitoring={monitoringOf(p.id, live, p.syncOnly)} />,
                sort: "monitoring",
                filter: "monitoring",
                filterOptions: MONITORING_FILTERS.map((v) => ({
                  value: v,
                  label: monitoringLabel(v),
                })),
              },
              ...tagColumn,
              {
                id: "prints",
                header: t("printers:detail.stats.prints"),
                numeric: true,
                cell: (p) => formatNumber(p.prints),
                sort: "prints",
                filter: "prints",
              },
              {
                id: "runtime",
                header: t("printers:detail.stats.time"),
                numeric: true,
                cell: (p) => formatDuration(p.runtimeSec),
                sort: "runtimeSec",
                filter: "runtimeSec",
                filterScale: 3600,
                filterHint: t("stats:hoursUnit"),
              },
              {
                id: "successRate",
                header: t("printers:detail.stats.successRate"),
                numeric: true,
                cell: (p) =>
                  p.successRate === null
                    ? ""
                    : formatNumber(p.successRate / 100, { style: "percent" }),
                sort: "successRate",
                filter: "successRate",
                filterHint: "%",
              },
              {
                id: "power",
                header: t("printers:list.columns.power"),
                numeric: true,
                cell: (p) =>
                  p.powerW === null
                    ? ""
                    : t("printers:detail.info.powerValue", { value: p.powerW }),
                sort: "powerW",
                filter: "powerW",
              },
              archiveColumn<PrinterRow>(t, {
                kind: "printers",
                can: "printers",
                level: "manage",
                name: (p) => printerName(t, p),
              }),
            ]}
          />
        )
      )}
    </>
  );
}

/** Every accessory and the printer it is on. */
function AccessoriesTable({ add }: { add: ReactNode }) {
  const { t } = useTranslation();
  const stateLabel = useStateLabel();
  const states = usePreferences().data?.values.printerStates ?? [];
  const [query, setQuery] = useUrlListQuery("accessories.");
  const { data } = useListPage<Accessory>(["accessories", "list"], "/api/accessories", query);
  const hasArchived = useHasArchived(["accessories", "list"], "/api/accessories");
  const printers = usePrinters({ archived: "all" }).data?.items ?? [];
  const printerOf = new Map(printers.map((p) => [p.id, p]));
  const tagColumn = useTagColumn<Accessory>("accessory");

  return (
    <>
      {data && !data.total && !Object.keys(query).length && !hasArchived ? (
        <EmptyState
          icon={Puzzle}
          title={t("printers:accessories.emptyTitle")}
          description={t("printers:accessories.emptyBody")}
          action={add}
        />
      ) : (
        data && (
          <DataTable
            label={t("printers:accessories.table")}
            rows={data.items}
            rowKey={(a) => a.id}
            server={{
              query,
              onQueryChange: setQuery,
              total: data.total,
              filters: accessoryFilters,
              archivable: true,
            }}
            columns={[
              {
                id: "name",
                header: t("printers:accessories.columns.name"),
                cell: (a) => (
                  <Link to="/printers/accessories/$id" params={{ id: a.id }} className={textLink}>
                    {accessoryName(t, a)}
                  </Link>
                ),
                sort: "name",
                filter: "name",
              },
              {
                id: "type",
                header: t("printers:accessories.columns.type"),
                cell: (a) => a.type,
                sort: "type",
                filter: "type",
              },
              {
                id: "state",
                header: t("printers:accessories.columns.state"),
                cell: (a) => <StateBadge state={a.state} />,
                sort: "state",
                filter: "state",
                filterOptions: states.map((s) => ({ value: s, label: stateLabel(s) })),
              },
              ...tagColumn,
              {
                id: "printer",
                header: t("printers:accessories.columns.printer"),
                cell: (a) => {
                  const p = a.printerId && printerOf.get(a.printerId);
                  return (
                    p && (
                      <span className="flex items-center gap-2">
                        <Link to="/printers/$id" params={{ id: p.id }} className={textLink}>
                          {printerName(t, p)}
                        </Link>
                        {p.archivedAt && <ArchivedBadge />}
                      </span>
                    )
                  );
                },
                sort: "printer",
                filter: "printerId",
                filterOptions: printers.map((p) => ({ value: p.id, label: printerName(t, p) })),
              },
              {
                id: "prints",
                header: t("printers:detail.stats.prints"),
                numeric: true,
                cell: (a) => formatNumber(a.prints),
                sort: "prints",
                filter: "prints",
              },
              {
                id: "runtime",
                header: t("printers:detail.stats.time"),
                numeric: true,
                cell: (a) => formatDuration(a.runtimeSec),
                sort: "runtimeSec",
              },
              {
                id: "power",
                header: t("printers:list.columns.power"),
                numeric: true,
                cell: (a) =>
                  a.powerW === null
                    ? ""
                    : t("printers:detail.info.powerValue", { value: a.powerW }),
                sort: "powerW",
                filter: "powerW",
              },
              archiveColumn<Accessory>(t, {
                kind: "accessories",
                can: "printers",
                level: "manage",
                name: (a) => accessoryName(t, a),
              }),
            ]}
          />
        )
      )}
    </>
  );
}
