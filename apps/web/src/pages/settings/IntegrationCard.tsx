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
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Collapsible } from "../../components/Collapsible.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable, type ListQuery } from "../../components/DataTable.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Menu } from "../../components/Menu.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useCan } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import { formatDate, formatDateTime, formatRelative } from "../../lib/format.ts";
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
import { ActionSwitches, Policies } from "./PolicyRow.tsx";

// The status dot's colour; the line's text says the rest.
const DOT: Record<IntegrationStatus | "disabled", string> = {
  new: "bg-border",
  syncing: "bg-accent",
  ok: "bg-ok",
  error: "bg-bad",
  unavailable: "bg-warn",
  disabled: "bg-border",
};
const TRIGGERS = { manual: "integrations:runs.manual", scheduled: "integrations:runs.scheduled" };
const RUN_STATUSES = { ok: "integrations:runs.ok", error: "integrations:runs.error" };

/** One part of a card: a heading below a divider. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-5 grid gap-3 border-t border-border pt-4">
      <h4 id={id} className="font-semibold">
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * One integration: name, on/off and a status line; then its account (cloud) or slicer (local),
 * what it imports, and the sync log.
 */
export function IntegrationCard({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const navigate = useNavigate();
  const adapter = useAdapters().data?.find((a) => a.id === i.adapterId);
  // An editor gets the status line and their task rows only (ADR-0012).
  const admin = useCan("admin");
  const on = i.policies.filter((p) => p.mode !== "off");
  // Disabled = switched off entirely, so only the toggle and Delete stay. Sign-in and the test
  // only matter for an account with something switched on, the log for anything that syncs.
  const account = admin && i.enabled && i.kind === "cloud" && on.length > 0;
  const logged = admin && i.enabled && on.some((p) => !isAction(p.type));
  const hasLogin = account && adapter?.login;
  const imports = i.policies.some((p) => !isAction(p.type));
  const [confirming, setConfirming] = useState(false);
  const patch = usePatchIntegration(i.id);
  const sync = useSyncIntegration(i.id);
  const test = useTestIntegration(i.id);
  const remove = useDeleteIntegration(i.id);
  const failed = [patch, sync, remove].some((m) => m.isError);
  const name = adapterName(i.adapterId);

  // The status line: one sentence for where the integration stands.
  const state = !i.enabled ? "disabled" : sync.isPending ? "syncing" : i.status;
  const status =
    state === "disabled" ? (
      t("integrations:card.disabledHint")
    ) : state === "syncing" ? (
      t("integrations:card.syncing")
    ) : state === "unavailable" ? (
      t("integrations:card.unavailableHint")
    ) : state === "error" && i.lastError ? (
      t(ERRORS[i.lastError])
    ) : i.lastSyncAt ? (
      <time dateTime={i.lastSyncAt} title={formatDateTime(i.lastSyncAt)}>
        {t("integrations:card.lastSync", { date: formatRelative(i.lastSyncAt) })}
      </time>
    ) : state === "ok" ? (
      // A local source that is set up but hasn't imported anything yet.
      t("integrations:card.ready")
    ) : (
      t("integrations:card.never")
    );

  return (
    <li
      id={`integration-${i.id}`}
      className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-base font-semibold">{name}</h3>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
            {t(KINDS[i.kind])}
          </span>
        </div>
        {admin && (
          <div className="flex items-center gap-1">
            <Switch
              label={t("integrations:card.enabled")}
              checked={i.enabled}
              disabled={patch.isPending}
              onChange={(e) => patch.mutate({ enabled: e.target.checked })}
            />
            <Menu label={t("integrations:card.menu", { name })}>
              <Button
                variant="ghost"
                className="justify-start text-bad"
                onClick={() => setConfirming(true)}
              >
                {t("integrations:card.delete")}
              </Button>
            </Menu>
          </div>
        )}
      </div>

      <p
        role={state === "error" ? "alert" : undefined}
        className={cx("mt-2 flex items-start gap-2", state === "error" ? "text-bad" : "text-muted")}
      >
        <span aria-hidden className={cx("mt-1.5 size-2 shrink-0 rounded-full", DOT[state])} />
        <span>{status}</span>
      </p>
      {failed && (
        <p role="alert" className="mt-1 text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}

      {account && (
        <Part title={t("integrations:card.account")}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {adapter?.login && (
              <span className="text-muted">
                {i.hasSecrets
                  ? t("integrations:card.signedIn")
                  : t("integrations:card.notSignedIn")}
              </span>
            )}
            <span className="flex flex-wrap gap-2">
              {hasLogin && (
                <Button
                  variant={i.hasSecrets ? "secondary" : "primary"}
                  onClick={() => navigate({ to: "/integrations/$id/login", params: { id: i.id } })}
                >
                  {i.hasSecrets
                    ? t("integrations:card.signInAgain")
                    : t("integrations:card.signIn")}
                </Button>
              )}
              <Button disabled={test.isPending} onClick={() => test.mutate()}>
                {t("integrations:card.test")}
              </Button>
            </span>
          </div>
          {test.data && (
            <p role="status" className={test.data.ok ? "text-ok" : "text-bad"}>
              {test.data.ok ? t("integrations:card.testOk") : t(ERRORS[test.data.code])}
            </p>
          )}
        </Part>
      )}
      {admin && i.enabled && i.kind === "local" && (
        <Part title={t("integrations:slicer.title")}>
          <SlicerFields
            integration={i}
            detectedDir={adapter?.detectedConfigDir ?? null}
            program={i.policies.some((p) => isAction(p.type))}
          />
          <ActionSwitches integration={i} />
        </Part>
      )}
      {/* A cloud adapter's slicer actions (a local one has them in its slicer part). */}
      {admin && i.enabled && i.kind === "cloud" && i.policies.some((p) => isAction(p.type)) && (
        <Part title={t("integrations:card.actions")}>
          <ActionSwitches integration={i} />
        </Part>
      )}
      {i.enabled && imports && (
        <Part title={t("integrations:card.imports")}>
          <Policies integration={i} sync={sync} />
        </Part>
      )}
      {logged && (
        <Collapsible title={t("integrations:card.log")} className="mt-5">
          <SyncLog id={i.id} types={i.policies.map((p) => p.type).filter((c) => !isAction(c))} />
        </Collapsible>
      )}

      <ConfirmDialog
        open={confirming}
        title={t("integrations:deleteDialog.title", { name })}
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
    <div className="grid gap-3">
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
