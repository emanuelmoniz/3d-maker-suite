import {
  ALERT_SEVERITIES,
  type AlertSeverity,
  type Capability,
  type Integration,
  isAction,
  REVIEWED_TYPES,
  type ReviewedType,
  type SyncFrequency,
  type SyncMode,
  type SyncPolicy,
  type SyncRequest,
} from "@3d-maker-suite/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { usePatchIntegration, type useSyncIntegration } from "../../lib/integrations.ts";
import { CAPS } from "./integrationLabels.ts";

const RANGES = {
  sinceLast: "integrations:sync.ranges.sinceLast",
  d7: "integrations:sync.ranges.d7",
  d30: "integrations:sync.ranges.d30",
  d90: "integrations:sync.ranges.d90",
  year: "integrations:sync.ranges.year",
  custom: "integrations:sync.ranges.custom",
};
const FREQUENCIES: Record<SyncFrequency, string> = {
  "15m": "integrations:sync.frequencies.15m",
  "1h": "integrations:sync.frequencies.1h",
  "1d": "integrations:sync.frequencies.1d",
  "1w": "integrations:sync.frequencies.1w",
  "1M": "integrations:sync.frequencies.1M",
};
const MODES: Record<SyncMode, string> = {
  off: "integrations:policies.modes.off",
  manual: "integrations:policies.modes.manual",
  auto: "integrations:policies.modes.auto",
};
// Actions (`openInSlicer`, `slice`) are not data: they are only on or off.
const ACTION_MODES = {
  off: "integrations:policies.modes.off",
  manual: "integrations:policies.modes.on",
};
// Types whose rows are reviewed and confirmed. They can also run straight from here: a run
// imports the rows that need no decision (catalog rows, spools with one matching profile, presets
// whose brand and material exist) and leaves the rest pending for the review page.
const SEVERITY = {
  error: "integrations:policies.alertSeverity.error",
  warning: "integrations:policies.alertSeverity.warning",
  success: "integrations:policies.alertSeverity.success",
} as const satisfies Record<AlertSeverity, string>;
const isReviewed = (c: Capability): c is ReviewedType =>
  (REVIEWED_TYPES as readonly string[]).includes(c);

// A control inside a table row keeps clear of the row borders and never shrinks below its text
// (the table scrolls sideways on a phone instead).
const cellSelect = `${inputClass} my-1 min-w-max`;

const startOfDay = (daysAgo: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

/** The range for "Sync prints"; empty = continue from the last sync. Custom dates are local days. */
function rangeFor(range: keyof typeof RANGES, from: string, to: string): Partial<SyncRequest> {
  if (range === "d7") return { from: startOfDay(7) };
  if (range === "d30") return { from: startOfDay(30) };
  if (range === "d90") return { from: startOfDay(90) };
  if (range === "year") return { from: new Date(new Date().getFullYear(), 0, 1).toISOString() };
  if (range !== "custom") return {};
  return {
    ...(from && { from: new Date(`${from}T00:00:00`).toISOString() }),
    ...(to && { to: new Date(`${to}T23:59:59.999`).toISOString() }),
  };
}

/** One row per type the integration has: its mode, frequency, last sync and "run it now". */
export function Policies({
  integration: i,
  sync,
}: {
  integration: Integration;
  sync: ReturnType<typeof useSyncIntegration>;
}) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  const navigate = useNavigate();
  const [range, setRange] = useState<keyof typeof RANGES>("sinceLast");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const prints = i.capabilities.includes("prints");
  const customInvalid = range === "custom" && (!from || (!!to && to < from));
  const select = <T extends string>(
    value: T,
    options: Partial<Record<T, string>>,
    onChange: (v: T) => void,
    p: { id?: string; className?: string; "aria-label"?: string; "aria-describedby"?: string },
    disabled = false,
  ) => (
    <Combobox
      {...p}
      value={value}
      disabled={disabled}
      onChange={(v) => onChange(v as T)}
      options={(Object.keys(options) as T[]).map((k) => ({ value: k, label: t(options[k] ?? "") }))}
    />
  );
  const run = (p: SyncPolicy) => {
    // Switched off or not set up (no sign-in, no folder): nothing to run.
    if (!i.capabilities.includes(p.type)) return "–";
    if (p.type === "printers")
      return (
        <Button
          className="my-1"
          disabled={sync.isPending}
          onClick={() => sync.mutate({ type: "printers" })}
        >
          {t("integrations:policies.syncNow")}
        </Button>
      );
    const type = p.type;
    if (!isReviewed(type)) return "–";
    const dates = type === "prints" ? rangeFor(range, from, to) : {};
    const review = {
      to: "/import/$source/$id/$type",
      params: { source: "integration", id: i.id, type },
      search: dates as never,
    } as const;
    return (
      <span className="flex items-center gap-3">
        <Button
          className="my-1"
          disabled={sync.isPending || (type === "prints" && customInvalid)}
          onClick={() =>
            sync.mutate(
              { type, ...dates },
              // Rows were left for a person: take them there.
              { onSuccess: (r) => void (r.pending > 0 && navigate(review)) },
            )
          }
        >
          {t("integrations:policies.syncNow")}
        </Button>
        <Link {...review} className="font-medium text-accent hover:underline">
          {t("integrations:policies.importNow")}
        </Link>
        {p.pending > 0 && (
          <span className="text-muted">
            {t("integrations:policies.pending", { count: p.pending })}
          </span>
        )}
      </span>
    );
  };
  const tracking = (type: string) =>
    i.policies.some((p) => p.type === type && p.mode !== "off" && p.trackUsage);
  const doubleTracking = tracking("prints") && tracking("spools");
  return (
    <div className="mt-4 grid gap-3">
      {patch.isError && (
        <p role="alert" className="text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}
      <DataTable
        label={t("integrations:policies.title")}
        rows={i.policies}
        rowKey={(p) => p.type}
        columns={[
          { id: "type", header: t("integrations:policies.type"), cell: (p) => t(CAPS[p.type]) },
          {
            id: "mode",
            header: t("integrations:policies.mode"),
            cell: (p) =>
              select(
                p.mode,
                isAction(p.type) ? ACTION_MODES : MODES,
                (mode) => patch.mutate({ policies: [{ type: p.type, mode }] }),
                {
                  className: cellSelect,
                  "aria-label": t("integrations:policies.modeOf", { type: t(CAPS[p.type]) }),
                },
                patch.isPending,
              ),
          },
          {
            id: "frequency",
            header: t("integrations:policies.frequency"),
            cell: (p) =>
              isAction(p.type)
                ? "–"
                : select(
                    p.frequency,
                    FREQUENCIES,
                    (frequency) => patch.mutate({ policies: [{ type: p.type, frequency }] }),
                    {
                      className: cellSelect,
                      "aria-label": t("integrations:policies.frequencyOf", {
                        type: t(CAPS[p.type]),
                      }),
                    },
                    patch.isPending || p.mode !== "auto",
                  ),
          },
          {
            // Empty (null) = all three; picking all three again goes back to it.
            id: "alert",
            header: t("integrations:policies.alert"),
            cell: (p) =>
              isAction(p.type) || p.mode === "off" ? (
                "–"
              ) : (
                <div className="flex flex-wrap gap-x-3">
                  {ALERT_SEVERITIES.map((s) => {
                    const picked = (x: AlertSeverity) => p.alertSeverities?.includes(x) ?? true;
                    return (
                      <label key={s} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          aria-label={t("integrations:policies.alertOf", {
                            severity: t(SEVERITY[s]),
                            type: t(CAPS[p.type]),
                          })}
                          checked={picked(s)}
                          disabled={patch.isPending}
                          onChange={() => {
                            const next = ALERT_SEVERITIES.filter((x) =>
                              x === s ? !picked(s) : picked(x),
                            );
                            patch.mutate({
                              policies: [
                                {
                                  type: p.type,
                                  alertSeverities:
                                    next.length === ALERT_SEVERITIES.length ? null : next,
                                },
                              ],
                            });
                          }}
                        />
                        {t(SEVERITY[s])}
                      </label>
                    );
                  })}
                </div>
              ),
          },
          // Runs without a review (scheduled, "sync now"); a review asks on its own.
          // Only integrations that sync prints have a print policy to track.
          ...(i.policies.some((p) => p.type === "prints" || p.type === "spools")
            ? [
                {
                  id: "trackUsage",
                  header: t("integrations:policies.trackUsage"),
                  cell: (p: (typeof i.policies)[number]) =>
                    (p.type === "prints" || p.type === "spools") && p.mode !== "off" ? (
                      <input
                        type="checkbox"
                        aria-label={t(
                          p.type === "spools"
                            ? "integrations:policies.trackUsageSpools"
                            : "integrations:policies.trackUsageOf",
                          { type: t(CAPS[p.type]) },
                        )}
                        checked={p.trackUsage}
                        disabled={patch.isPending}
                        onChange={(e) =>
                          patch.mutate({
                            policies: [{ type: p.type, trackUsage: e.target.checked }],
                          })
                        }
                      />
                    ) : (
                      "–"
                    ),
                },
              ]
            : []),
          {
            id: "lastRun",
            header: t("integrations:policies.lastRun"),
            cell: (p) =>
              isAction(p.type)
                ? "–"
                : p.lastRunAt
                  ? formatDateTime(p.lastRunAt)
                  : t("integrations:policies.never"),
          },
          { id: "run", header: t("integrations:policies.run"), cell: run },
        ]}
      />
      <p className="text-muted">{t("integrations:policies.hint")}</p>
      {doubleTracking && (
        <p role="status" className="text-warn">
          {t("integrations:policies.doubleTracking")}
        </p>
      )}
      {prints && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("integrations:sync.range")} hint={t("integrations:sync.rangeHint")}>
            {(p) => select(range, RANGES, setRange, p)}
          </FormField>
        </div>
      )}
      {prints && range === "custom" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("integrations:sync.from")}>
            {(p) => (
              <input
                {...p}
                type="date"
                className={inputClass}
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t("integrations:sync.to")}>
            {(p) => (
              <input
                {...p}
                type="date"
                className={inputClass}
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </FormField>
        </div>
      )}
    </div>
  );
}
