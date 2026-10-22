import {
  type Integration,
  type IntegrationStatus,
  isAction,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  type SyncRun,
  syncRunFilters,
} from "@3d-maker-suite/core";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Collapsible } from "../../components/Collapsible.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable, type ListQuery } from "../../components/DataTable.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Menu } from "../../components/Menu.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { Switch } from "../../components/Switch.tsx";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import {
  useAdapterName,
  useAdapters,
  useCapable,
  useDeleteIntegration,
  usePatchIntegration,
  useSyncIntegration,
  useSyncRuns,
  useTestIntegration,
} from "../../lib/integrations.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";
import { CAPS, ERRORS, KINDS } from "./integrationLabels.ts";
import { Policies } from "./PolicyRow.tsx";

// Literal keys so `pnpm i18n:check` sees them.
const STATUS: Record<IntegrationStatus, { label: string; tone: string }> = {
  new: { label: "integrations:status.new", tone: "bg-surface-2 text-muted" },
  syncing: { label: "integrations:status.syncing", tone: "bg-accent-soft text-accent" },
  ok: { label: "integrations:status.ok", tone: "bg-ok/15 text-ok" },
  error: { label: "integrations:status.error", tone: "bg-bad/15 text-bad" },
  unavailable: { label: "integrations:status.unavailable", tone: "bg-surface-2 text-muted" },
};
const TRIGGERS = { manual: "integrations:runs.manual", scheduled: "integrations:runs.scheduled" };
const RUN_STATUSES = { ok: "integrations:runs.ok", error: "integrations:runs.error" };

export function IntegrationCard({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const navigate = useNavigate();
  const adapter = useAdapters().data?.find((a) => a.id === i.adapterId);
  const on = i.policies.filter((p) => p.mode !== "off");
  // Disabled = switched off entirely, so only the toggle and Delete stay. Sign-in and the test
  // only matter for an account with something switched on, the log for anything that syncs.
  const account = i.enabled && i.kind === "cloud" && on.length > 0;
  const logged = i.enabled && on.some((p) => !isAction(p.type));
  const hasLogin = account && adapter?.login;
  const [confirming, setConfirming] = useState(false);
  const patch = usePatchIntegration(i.id);
  const sync = useSyncIntegration(i.id);
  const test = useTestIntegration(i.id);
  const remove = useDeleteIntegration(i.id);
  const status = i.enabled
    ? STATUS[sync.isPending ? "syncing" : i.status]
    : { label: "integrations:status.disabled", tone: "bg-surface-2 text-muted" };
  const failed = [patch, sync, remove].some((m) => m.isError);

  const messages: { key: string; text: string; tone: string; role?: "alert" | "status" }[] = [];
  const say = (key: string, text: string, tone = "text-muted", role?: "alert" | "status") =>
    messages.push({ key, text, tone, role });
  if (!i.enabled) say("disabled", t("integrations:card.disabledHint"));
  if (i.enabled && i.status === "unavailable")
    say("unavailable", t("integrations:card.unavailableHint"));
  if (i.status === "error" && i.lastError)
    say("error", t(ERRORS[i.lastError]), "text-bad", "alert");
  if (test.data)
    say(
      "test",
      test.data.ok ? t("integrations:card.testOk") : t(ERRORS[test.data.code]),
      test.data.ok ? "text-ok" : "text-bad",
      "status",
    );
  if (failed) say("action", t("integrations:card.actionError"), "text-bad", "alert");
  const lines = messages.map((m) => (
    <p key={m.key} role={m.role} className={m.tone}>
      {m.text}
    </p>
  ));

  return (
    <li
      id={`integration-${i.id}`}
      className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-base font-semibold">{adapterName(i.adapterId)}</h3>
          <span className="text-muted">· {t(KINDS[i.kind])}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>
            {t(status.label)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Switch
            label={t("integrations:card.enabled")}
            checked={i.enabled}
            disabled={patch.isPending}
            onChange={(e) => patch.mutate({ enabled: e.target.checked })}
          />
          <Menu label={t("integrations:card.menu", { name: adapterName(i.adapterId) })}>
            {account && (
              <Button
                variant="ghost"
                className="justify-start"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {t("integrations:card.test")}
              </Button>
            )}
            {hasLogin && (
              <Button
                variant="ghost"
                className="justify-start"
                onClick={() => navigate({ to: "/integrations/$id/login", params: { id: i.id } })}
              >
                {i.hasSecrets ? t("integrations:card.signInAgain") : t("integrations:card.signIn")}
              </Button>
            )}
            <Button
              variant="ghost"
              className="justify-start text-bad"
              onClick={() => setConfirming(true)}
            >
              {t("integrations:card.delete")}
            </Button>
          </Menu>
        </div>
      </div>

      {i.kind === "cloud" && (
        <p className="mt-2 text-muted">
          {i.lastSyncAt
            ? t("integrations:card.lastSync", { date: formatDateTime(i.lastSyncAt) })
            : t("integrations:card.never")}
        </p>
      )}
      {lines.length > 1 ? (
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">
            {t("integrations:card.messages", { count: lines.length })}
          </summary>
          <div className="mt-1 grid gap-1">{lines}</div>
        </details>
      ) : (
        <div className="mt-2 grid gap-1">{lines}</div>
      )}

      {i.enabled && i.policies.length > 0 && (
        <Collapsible title={t("integrations:card.sync")} defaultOpen className="mt-4">
          <Policies integration={i} sync={sync} />
        </Collapsible>
      )}
      {i.enabled && i.kind === "local" && (
        <Collapsible title={t("integrations:slicer.title")} className="mt-3">
          <SlicerFields
            integration={i}
            detectedDir={adapter?.detectedConfigDir ?? null}
            program={i.policies.some((p) => isAction(p.type))}
          />
        </Collapsible>
      )}
      {logged && (
        <Collapsible title={t("integrations:card.log")} className="mt-3">
          <SyncLog id={i.id} types={i.policies.map((p) => p.type).filter((c) => !isAction(c))} />
        </Collapsible>
      )}

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

function SlicerFields({
  integration: i,
  detectedDir,
  program,
}: {
  integration: Integration;
  detectedDir: string | null;
  /** The adapter can open files in the slicer, so it needs the program's path. */
  program: boolean;
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
        <div className="flex gap-2">
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
          <PathPicker
            label={label}
            mode={field === "slicerPath" ? "file" : "folder"}
            // Only Windows marks programs by extension.
            ext={field === "slicerPath" ? (sep) => (sep === "\\" ? ".exe" : undefined) : undefined}
            initial={i[field] || placeholder}
            onPick={(v) => v !== i[field] && patch.mutate({ [field]: v })}
          />
        </div>
      )}
    </FormField>
  );
  return (
    <div className="grid gap-3 p-1">
      {path(
        "slicerConfigDir",
        t("integrations:slicer.configDir"),
        t("integrations:slicer.configDirHint", { dir: detectedDir ?? "–" }),
        detectedDir ?? "",
      )}
      {program &&
        path("slicerPath", t("integrations:slicer.path"), t("integrations:slicer.pathHint"))}
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
    </div>
  );
}

// Local state, not the URL: every integration card has its own log.
function SyncLog({ id, types }: { id: string; types: SyncRun["type"][] }) {
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
    return <p className="p-1 text-muted">{t("integrations:runs.empty")}</p>;
  return (
    <div>
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
            cell: (r) => (r.type ? t(CAPS[r.type]) : t("integrations:runs.all")),
            filter: "type",
            filterOptions: types.flatMap((v) => (v ? [{ value: v, label: t(CAPS[v]) }] : [])),
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
