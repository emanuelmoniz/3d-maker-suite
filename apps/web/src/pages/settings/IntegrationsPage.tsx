import {
  CAPABILITY_NEEDS,
  type Capability,
  type Integration,
  type IntegrationErrorCode,
  type IntegrationStatus,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  SYNC_TYPES,
  type SyncFrequency,
  type SyncRequest,
  type SyncRun,
  syncRunFilters,
} from "@3d-maker-suite/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plug, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable, type ListQuery } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import {
  useAdapterName,
  useAdapters,
  useCapable,
  useDeleteIntegration,
  useIntegrations,
  usePatchIntegration,
  useSyncIntegration,
  useSyncRuns,
  useTestIntegration,
} from "../../lib/integrations.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";

// Literal keys so `pnpm i18n:check` sees them.
const STATUS: Record<IntegrationStatus, { label: string; tone: string }> = {
  new: { label: "integrations:status.new", tone: "bg-surface-2 text-muted" },
  syncing: { label: "integrations:status.syncing", tone: "bg-accent-soft text-accent" },
  ok: { label: "integrations:status.ok", tone: "bg-ok/15 text-ok" },
  error: { label: "integrations:status.error", tone: "bg-bad/15 text-bad" },
};
export const ERRORS: Record<IntegrationErrorCode, string> = {
  auth_required: "integrations:errors.auth_required",
  auth_expired: "integrations:errors.auth_expired",
  rate_limited: "integrations:errors.rate_limited",
  unreachable: "integrations:errors.unreachable",
  login_failed: "integrations:errors.login_failed",
  code_invalid: "integrations:errors.code_invalid",
  blocked: "integrations:errors.blocked",
  api_changed: "integrations:errors.api_changed",
  unknown: "integrations:errors.unknown",
};
const CAPS: Record<Capability, string> = {
  printers: "integrations:capabilities.printers",
  prints: "integrations:capabilities.prints",
  spools: "integrations:capabilities.spools",
  filamentProfiles: "integrations:capabilities.filamentProfiles",
  openInSlicer: "integrations:capabilities.openInSlicer",
};
const TRIGGERS = { manual: "integrations:runs.manual", scheduled: "integrations:runs.scheduled" };
const TYPES = {
  printers: "integrations:runs.printers",
  prints: "integrations:runs.prints",
};
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
  off: "integrations:sync.frequencies.off",
};
const RUN_STATUSES = { ok: "integrations:runs.ok", error: "integrations:runs.error" };

const addClass =
  "inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const { data, isError } = useIntegrations();
  const canAdd = !!useAdapters().data?.length;
  const add = canAdd && (
    <Link to="/settings/integrations/new" className={addClass}>
      <Plus className="size-4" aria-hidden />
      {t("integrations:add")}
    </Link>
  );
  return (
    <>
      <PageHeader
        title={t("integrations:title")}
        description={t("integrations:description")}
        backTo={{ to: "/settings" }}
        actions={add}
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("integrations:loadError")}
        </p>
      )}
      {data &&
        (data.length ? (
          <ul className="grid gap-4">
            {data.map((i) => (
              <IntegrationCard key={i.id} integration={i} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Plug}
            title={t("integrations:emptyTitle")}
            description={canAdd ? t("integrations:emptyBody") : t("integrations:noAdapters")}
            action={add}
          />
        ))}
    </>
  );
}

function IntegrationCard({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const navigate = useNavigate();
  const adapter = useAdapters().data?.find((a) => a.id === i.adapterId);
  const supported = adapter?.capabilities ?? [];
  const off = supported.filter((c) => i.disabledFeatures.includes(c));
  // Disabled = switched off entirely, so only the toggle and Delete stay. Sign-in, sync and the
  // log only matter while an account feature is switched on.
  const account =
    i.enabled && supported.some((c) => CAPABILITY_NEEDS[c] === "account" && !off.includes(c));
  const hasLogin = account && adapter?.login;
  const [showLog, setShowLog] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const patch = usePatchIntegration(i.id);
  const sync = useSyncIntegration(i.id);
  const test = useTestIntegration(i.id);
  const remove = useDeleteIntegration(i.id);
  const status = i.enabled
    ? STATUS[sync.isPending ? "syncing" : i.status]
    : { label: "integrations:status.disabled", tone: "bg-surface-2 text-muted" };
  const failed = [patch, sync, remove].some((m) => m.isError);

  return (
    <li className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{adapterName(i.adapterId)}</h2>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>
          {t(status.label)}
        </span>
      </div>

      {!i.enabled && <p className="mt-3 text-muted">{t("integrations:card.disabledHint")}</p>}
      <p className="mt-3 text-muted">
        {i.lastSyncAt
          ? t("integrations:card.lastSync", { date: formatDateTime(i.lastSyncAt) })
          : t("integrations:card.never")}
      </p>
      {i.status === "error" && i.lastError && (
        <p role="alert" className="mt-1 text-bad">
          {t(ERRORS[i.lastError])}
        </p>
      )}
      {test.data && (
        <p role="status" className={`mt-1 ${test.data.ok ? "text-ok" : "text-bad"}`}>
          {test.data.ok ? t("integrations:card.testOk") : t(ERRORS[test.data.code])}
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-1 text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {hasLogin && (
          <Button
            variant={i.hasSecrets ? "secondary" : "primary"}
            onClick={() =>
              navigate({ to: "/settings/integrations/$id/login", params: { id: i.id } })
            }
          >
            {i.hasSecrets ? t("integrations:card.signInAgain") : t("integrations:card.signIn")}
          </Button>
        )}
        {account && (
          <>
            <Button disabled={test.isPending} onClick={() => test.mutate()}>
              {t("integrations:card.test")}
            </Button>
            <Button variant="ghost" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
              {showLog ? t("integrations:card.hideLog") : t("integrations:card.showLog")}
            </Button>
          </>
        )}
        <Button variant="ghost" className="text-bad" onClick={() => setConfirming(true)}>
          {t("integrations:card.delete")}
        </Button>
        <label className="ml-auto flex items-center gap-2">
          <input
            type="checkbox"
            checked={i.enabled}
            disabled={patch.isPending}
            onChange={(e) => patch.mutate({ enabled: e.target.checked })}
          />
          {t("integrations:card.enabled")}
        </label>
      </div>

      {account && (
        <SyncControls integration={i} primary={!(hasLogin && !i.hasSecrets)} sync={sync} />
      )}

      {i.enabled && supported.length > 0 && (
        <fieldset className="mt-4">
          <legend className="font-medium">{t("integrations:capabilities.title")}</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {supported.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!off.includes(c)}
                  disabled={patch.isPending}
                  onChange={(e) =>
                    patch.mutate({
                      disabledFeatures: e.target.checked ? off.filter((d) => d !== c) : [...off, c],
                    })
                  }
                />
                {t(CAPS[c])}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {i.enabled &&
        (supported.includes("filamentProfiles") || supported.includes("openInSlicer")) && (
          <SlicerFields integration={i} detectedDir={adapter?.detectedConfigDir ?? null} />
        )}

      {account && showLog && <SyncLog id={i.id} />}

      <ConfirmDialog
        open={confirming}
        title={t("integrations:deleteDialog.title", { name: adapterName(i.adapterId) })}
        description={t("integrations:deleteDialog.body")}
        confirmLabel={t("integrations:card.delete")}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate();
        }}
      />
    </li>
  );
}

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

function SyncControls({
  integration: i,
  primary,
  sync,
}: {
  integration: Integration;
  primary: boolean;
  sync: ReturnType<typeof useSyncIntegration>;
}) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  const [range, setRange] = useState<keyof typeof RANGES>("sinceLast");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const printers = i.capabilities.includes("printers");
  const prints = i.capabilities.includes("prints");
  const customInvalid = range === "custom" && (!from || (!!to && to < from));
  const select = <T extends string>(
    value: T,
    options: Record<T, string>,
    onChange: (v: T) => void,
    p: object,
    disabled = false,
  ) => (
    <select
      {...p}
      className={inputClass}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {(Object.keys(options) as T[]).map((k) => (
        <option key={k} value={k}>
          {t(options[k])}
        </option>
      ))}
    </select>
  );
  return (
    <fieldset className="mt-4 grid gap-3">
      <legend className="mb-2 font-medium">{t("integrations:sync.title")}</legend>
      {patch.isError && (
        <p role="alert" className="text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {printers && prints && (
          <Button
            variant={primary ? "primary" : "secondary"}
            disabled={sync.isPending}
            onClick={() => sync.mutate(undefined)}
          >
            {t("integrations:card.syncNow")}
          </Button>
        )}
        {printers && (
          <Button
            variant={primary && !prints ? "primary" : "secondary"}
            disabled={sync.isPending}
            onClick={() => sync.mutate({ type: "printers" })}
          >
            {t("integrations:card.syncPrinters")}
          </Button>
        )}
        {prints && (
          <Button
            variant={primary && !printers ? "primary" : "secondary"}
            disabled={sync.isPending || customInvalid}
            onClick={() => sync.mutate({ type: "prints", ...rangeFor(range, from, to) })}
          >
            {t("integrations:card.syncPrints")}
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {prints && (
          <FormField label={t("integrations:sync.range")} hint={t("integrations:sync.rangeHint")}>
            {(p) => select(range, RANGES, setRange, p)}
          </FormField>
        )}
        <FormField
          label={t("integrations:sync.frequency")}
          hint={t("integrations:sync.frequencyHint")}
        >
          {(p) =>
            select(
              i.syncFrequency,
              FREQUENCIES,
              (syncFrequency) => patch.mutate({ syncFrequency }),
              p,
              patch.isPending,
            )
          }
        </FormField>
      </div>
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
    </fieldset>
  );
}

function SlicerFields({
  integration: i,
  detectedDir,
}: {
  integration: Integration;
  detectedDir: string | null;
}) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  const savePrefs = useSavePreferences();
  const defaultId = usePreferences().data?.values.defaultSlicerId;
  const slicers = useCapable("openInSlicer");
  // The default is the chosen one if it still works, else the first (same rule as the server).
  const current = slicers.find((s) => s.id === defaultId) ?? slicers[0];
  const path = (
    field: "slicerConfigDir" | "slicerPath",
    label: string,
    hint: string,
    placeholder = "",
  ) => (
    <FormField label={label} hint={hint}>
      {(p) => (
        <input
          {...p}
          className={inputClass}
          key={`${field}-${i[field] ?? ""}`}
          defaultValue={i[field] ?? ""}
          placeholder={placeholder}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (i[field] ?? "")) patch.mutate({ [field]: v });
          }}
        />
      )}
    </FormField>
  );
  return (
    <fieldset className="mt-4 grid gap-3">
      <legend className="mb-2 font-medium">{t("integrations:slicer.title")}</legend>
      {path(
        "slicerConfigDir",
        t("integrations:slicer.configDir"),
        t("integrations:slicer.configDirHint", { dir: detectedDir ?? "–" }),
        detectedDir ?? "",
      )}
      {path("slicerPath", t("integrations:slicer.path"), t("integrations:slicer.pathHint"))}
      {slicers.length > 1 &&
        i.capabilities.includes("openInSlicer") &&
        (current?.id === i.id ? (
          <p className="text-muted">{t("integrations:slicer.isDefault")}</p>
        ) : (
          <Button
            className="justify-self-start"
            disabled={savePrefs.isPending}
            onClick={() => savePrefs.mutate({ defaultSlicerId: i.id })}
          >
            {t("integrations:slicer.makeDefault")}
          </Button>
        ))}
    </fieldset>
  );
}

// Local state, not the URL: every integration card has its own log.
function SyncLog({ id }: { id: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState<ListQuery>({ pageSize: "10" });
  const { data } = useSyncRuns(id, query);
  const rangeLabel = (r: SyncRun) => {
    const [from, to] = [r.rangeFrom, r.rangeTo].map((d) => (d ? formatDate(d) : ""));
    if (from && to) return t("integrations:runs.rangeBetween", { from, to });
    if (from) return t("integrations:runs.rangeFrom", { from });
    if (to) return t("integrations:runs.rangeTo", { to });
    return "–";
  };
  if (!data) return null;
  if (!data.total && Object.keys(query).length <= 1)
    return <p className="mt-4 text-muted">{t("integrations:runs.empty")}</p>;
  return (
    <div className="mt-4">
      <DataTable
        label={t("integrations:runs.table")}
        rows={data.items}
        rowKey={(r) => r.id}
        server={{
          query,
          onQueryChange: setQuery,
          total: data.total,
          filters: syncRunFilters,
          defaultSort: "-startedAt",
        }}
        columns={[
          {
            id: "startedAt",
            header: t("integrations:runs.started"),
            cell: (r) => formatDateTime(r.startedAt),
            sort: "startedAt",
            filter: "startedAt",
          },
          {
            id: "type",
            header: t("integrations:runs.type"),
            cell: (r) => (r.type ? t(TYPES[r.type]) : t("integrations:runs.all")),
            filter: "type",
            filterOptions: SYNC_TYPES.map((v) => ({ value: v, label: t(TYPES[v]) })),
          },
          {
            id: "range",
            header: t("integrations:runs.range"),
            cell: (r) => rangeLabel(r),
          },
          {
            id: "trigger",
            header: t("integrations:runs.trigger"),
            cell: (r) => t(TRIGGERS[r.trigger]),
            filter: "trigger",
            filterOptions: SYNC_TRIGGERS.map((v) => ({ value: v, label: t(TRIGGERS[v]) })),
          },
          {
            id: "result",
            header: t("integrations:runs.result"),
            cell: (r) =>
              r.errorCode ? (
                <span className="text-bad">{t(ERRORS[r.errorCode])}</span>
              ) : (
                <span className="flex flex-wrap gap-x-3">
                  <span>{t("integrations:runs.created", { count: r.created })}</span>
                  <span className="text-muted">
                    {t("integrations:runs.skipped", { count: r.skipped })}
                  </span>
                </span>
              ),
            filter: "status",
            filterOptions: SYNC_RUN_STATUSES.map((v) => ({ value: v, label: t(RUN_STATUSES[v]) })),
          },
        ]}
      />
    </div>
  );
}
