import type { Integration, IntegrationErrorCode, IntegrationStatus } from "@3d-maker-suite/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plug, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { formatDateTime } from "../../lib/format.ts";
import {
  useAdapters,
  useDeleteIntegration,
  useIntegrations,
  usePatchIntegration,
  useSyncIntegration,
  useSyncRuns,
  useTestIntegration,
} from "../../lib/integrations.ts";

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
const TRIGGERS = { manual: "integrations:runs.manual", scheduled: "integrations:runs.scheduled" };

/** Vendor names live under `integrations:adapters.<id>` so a new adapter only adds locale keys. */
export function useAdapterName() {
  const { t } = useTranslation();
  return (id: string) => t(`integrations:adapters.${id}.name`, { defaultValue: id });
}

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
  const hasLogin = useAdapters().data?.find((a) => a.id === i.adapterId)?.login;
  const [showLog, setShowLog] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const patch = usePatchIntegration(i.id);
  const sync = useSyncIntegration(i.id);
  const test = useTestIntegration(i.id);
  const remove = useDeleteIntegration(i.id);
  const status = STATUS[sync.isPending ? "syncing" : i.status];
  const failed = [patch, sync, remove].some((m) => m.isError);

  return (
    <li className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{i.name}</h2>
          <p className="text-muted">{adapterName(i.adapterId)}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>
          {t(status.label)}
        </span>
      </div>

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
        <Button
          variant={hasLogin && !i.hasSecrets ? "secondary" : "primary"}
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          {t("integrations:card.syncNow")}
        </Button>
        <Button disabled={test.isPending} onClick={() => test.mutate()}>
          {t("integrations:card.test")}
        </Button>
        <Button variant="ghost" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
          {showLog ? t("integrations:card.hideLog") : t("integrations:card.showLog")}
        </Button>
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

      {showLog && <SyncLog id={i.id} />}

      <ConfirmDialog
        open={confirming}
        title={t("integrations:deleteDialog.title", { name: i.name })}
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

function SyncLog({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data } = useSyncRuns(id, true);
  if (!data) return null;
  if (!data.length) return <p className="mt-4 text-muted">{t("integrations:runs.empty")}</p>;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left">
        <thead className="text-muted">
          <tr>
            <th className="py-1 pr-4 font-medium">{t("integrations:runs.started")}</th>
            <th className="py-1 pr-4 font-medium">{t("integrations:runs.trigger")}</th>
            <th className="py-1 font-medium">{t("integrations:runs.result")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-1.5 pr-4 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
              <td className="py-1.5 pr-4">{t(TRIGGERS[r.trigger])}</td>
              <td className="py-1.5">
                {r.errorCode ? (
                  <span className="text-bad">{t(ERRORS[r.errorCode])}</span>
                ) : (
                  <span className="flex flex-wrap gap-x-3">
                    <span>{t("integrations:runs.created", { count: r.created })}</span>
                    <span className="text-muted">
                      {t("integrations:runs.skipped", { count: r.skipped })}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
