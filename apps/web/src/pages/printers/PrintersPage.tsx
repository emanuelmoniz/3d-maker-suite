import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Printer as PrinterIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { usePreferences } from "../../lib/preferences.ts";
import { usePrinters } from "../../lib/printers.ts";
import { StateBadge, useStateLabel } from "./StateBadge.tsx";

const addClass =
  "inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

export function PrintersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stateLabel = useStateLabel();
  const states = usePreferences().data?.values.printerStates ?? [];
  const [state, setState] = useState("");
  const [archived, setArchived] = useState(false);
  const { data, isError } = usePrinters({ state: state || undefined, archived });

  const add = (
    <Link to="/printers/new" className={addClass}>
      <Plus className="size-4" aria-hidden />
      {t("printers:list.add")}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t("nav:items.printers.label")}
        description={t("nav:items.printers.description")}
        actions={add}
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("printers:loadError")}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <select
          aria-label={t("printers:list.stateFilter")}
          className={`${inputClass} w-auto`}
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">{t("printers:list.allStates")}</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {stateLabel(s)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t("printers:list.showArchived")}
        </label>
      </div>
      {data && !data.total && !state && !archived ? (
        <EmptyState
          icon={PrinterIcon}
          title={t("printers:list.emptyTitle")}
          description={t("printers:list.emptyBody")}
          action={add}
        />
      ) : (
        data && (
          <DataTable
            label={t("printers:list.table")}
            rows={data.items}
            rowKey={(p) => p.id}
            onRowClick={(p) => navigate({ to: "/printers/$id", params: { id: p.id } })}
            columns={[
              {
                id: "name",
                header: t("printers:list.columns.name"),
                cell: (p) => (
                  <Link
                    to="/printers/$id"
                    params={{ id: p.id }}
                    className="font-medium hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.name}
                  </Link>
                ),
                sortValue: (p) => p.name.toLowerCase(),
              },
              {
                id: "model",
                header: t("printers:list.columns.model"),
                cell: (p) => `${p.brand} ${p.model}`.trim(),
                sortValue: (p) => `${p.brand} ${p.model}`.toLowerCase(),
              },
              {
                id: "state",
                header: t("printers:list.columns.state"),
                cell: (p) => <StateBadge state={p.state} />,
                sortValue: (p) => p.state,
              },
              {
                id: "power",
                header: t("printers:list.columns.power"),
                numeric: true,
                cell: (p) =>
                  p.powerW === null
                    ? ""
                    : t("printers:detail.info.powerValue", { value: p.powerW }),
                sortValue: (p) => p.powerW ?? 0,
              },
            ]}
          />
        )
      )}
    </>
  );
}
