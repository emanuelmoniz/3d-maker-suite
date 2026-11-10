import {
  type Integration,
  type IntegrationStatus,
  isAction,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  type SyncRun,
  syncRunFilters,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Collapsible } from "../../components/Collapsible.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable, type ListQuery } from "../../components/DataTable.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Menu } from "../../components/Menu.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { useCanSettings } from "../../components/SettingsLink.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useCan } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import { formatDate, formatDateTime, formatRelative } from "../../lib/format.ts";
import {
  catalogSummary,
  useAdapterName,
  useAdapters,
  useCapable,
  useDeleteIntegration,
  useLocationLabel,
  usePatchIntegration,
  useSyncIntegration,
  useSyncRuns,
} from "../../lib/integrations.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";
import { CAPS, ERRORS, LOCATION_ICONS } from "./integrationLabels.ts";
import { ManagedSlicer } from "./ManagedSlicer.tsx";
import { ActionSwitches } from "./PolicyRow.tsx";
import { WorkerSlicer } from "./WorkerSlicer.tsx";

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

const addClass =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-border px-3 font-medium hover:bg-surface-2";

/** Its catalog import cards, now on Presets settings → Sources: how many run on their own, how many wait. */
function CatalogLine({ library, rows }: { library: string; rows: Integration[] }) {
  const { t } = useTranslation();
  const sources = useCanSettings("presets");
  const s = catalogSummary(rows);
  if (!s.cards) return null;
  const line =
    s.auto || s.review ? (
      <Trans
        t={t}
        i18nKey="integrations:card.summary"
        values={{ auto: s.auto, review: s.review }}
        components={{ review: <span className={s.review ? "text-warn" : undefined} /> }}
      />
    ) : (
      t("integrations:card.summaryOff")
    );
  return sources ? (
    <Link
      to="/presets/settings/sources"
      hash={`library-${library}`}
      className="text-muted underline-offset-2 hover:text-fg hover:underline"
    >
      {line}
    </Link>
  ) : (
    <span className="text-muted">{line}</span>
  );
}

/**
 * One card per slicer (or account): its name, its catalog line and the places it runs, one row
 * each (ADR-0019). The rows' icons sit on a rail: one slicer, several places.
 */
export function LibraryCard({ library, rows }: { library: string; rows: Integration[] }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const admin = useCan("integrations.manage");
  const slicer = rows.some((i) => i.kind !== "cloud");
  return (
    <section
      aria-labelledby={`library-${library}`}
      className="rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 gap-1">
          <h2 id={`library-${library}`} className="text-lg font-semibold">
            {adapterName(library)}
          </h2>
          <CatalogLine library={library} rows={rows} />
        </div>
        {admin && slicer && (
          <Link to="/integrations/new" search={{ product: library }} className={addClass}>
            <Plus aria-hidden className="size-4" />
            {t("integrations:card.addLocation")}
          </Link>
        )}
      </div>
      <ul className="mt-2">
        {rows.map((i) => (
          <IntegrationCard key={i.id} integration={i} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One place a slicer runs (or an account): where, on/off and a status line; then its account
 * (cloud) or slicer, what it imports that isn't catalog, and the sync log.
 */
export function IntegrationCard({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const locationLabel = useLocationLabel();
  const adapter = useAdapters().data?.find((a) => a.id === i.adapterId);
  // An editor gets the status line and their task rows only (ADR-0012).
  const admin = useCan("integrations.manage");
  const on = i.policies.filter((p) => p.mode !== "off");
  // Disabled = switched off entirely, so only the toggle and Delete stay; the log is for anything
  // that syncs. Accounts have their own card (AccountCard.tsx).
  const logged = admin && i.enabled && on.some((p) => !isAction(p.type));
  const [confirming, setConfirming] = useState(false);
  const patch = usePatchIntegration(i.id);
  const sync = useSyncIntegration(i.id);
  const remove = useDeleteIntegration(i.id);
  const failed = [patch, sync, remove].some((m) => m.isError);
  const where = locationLabel(i);
  const name = t("integrations:nameOnDevice", { name: adapterName(i.adapterId), device: where });
  const Icon = LOCATION_ICONS[i.kind];
  // Closed by default; a deep link (an alert's "Open integration") opens it.
  const [open, setOpen] = useState(() => location.hash === `#integration-${i.id}`);
  const bodyId = useId();

  // The status line: one sentence for where the integration stands.
  const state = !i.enabled ? "disabled" : sync.isPending ? "syncing" : i.status;
  const status =
    state === "disabled" ? (
      t("integrations:card.disabledHint")
    ) : state === "syncing" ? (
      t("integrations:card.syncing")
    ) : state === "unavailable" ? (
      i.kind === "server" ? (
        t("integrations:managed.notInstalledHint")
      ) : i.kind === "worker" ? (
        t("integrations:worker.unavailableHint")
      ) : (
        t("integrations:card.unavailableHint")
      )
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
      // The rail: a line from this row's icon down to the next one's.
      className="relative grid scroll-mt-4 grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 py-3 before:absolute before:top-13 before:-bottom-4 before:left-4.5 before:w-px before:bg-border last:before:hidden"
    >
      <span
        aria-hidden
        className="relative mt-1 grid size-9 place-items-center rounded-md border border-border bg-surface-2 text-muted"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="min-w-0 text-base font-semibold">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={name}
              onClick={() => setOpen(!open)}
              className="flex min-h-11 max-w-full items-center gap-2 rounded-md text-left"
            >
              <span className="truncate">{where}</span>
              <ChevronRight
                aria-hidden
                className={cx(
                  "size-4 shrink-0 text-muted transition-transform",
                  open && "rotate-90",
                )}
              />
            </button>
          </h3>
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
          className={cx("flex items-start gap-2", state === "error" ? "text-bad" : "text-muted")}
        >
          <span aria-hidden className={cx("mt-1.5 size-2 shrink-0 rounded-full", DOT[state])} />
          <span>{status}</span>
        </p>
        {failed && (
          <p role="alert" className="mt-1 text-bad">
            {t("integrations:card.actionError")}
          </p>
        )}
      </div>

      {/* Past the rail on wider screens, the full width on a phone. */}
      {open && (
        <div id={bodyId} className="col-span-2 sm:col-span-1 sm:col-start-2">
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
          {admin && i.enabled && i.kind === "server" && adapter?.managed && (
            <Part title={t("integrations:slicer.title")}>
              <ManagedSlicer
                integration={i}
                libraryId={adapter.libraryId}
                managed={adapter.managed}
              />
              <DefaultSlicer integration={i} />
              <ActionSwitches integration={i} />
            </Part>
          )}
          {admin && i.enabled && i.kind === "worker" && adapter && (
            <Part title={t("integrations:slicer.title")}>
              <WorkerSlicer integration={i} adapter={adapter} />
              <DefaultSlicer integration={i} />
              <ActionSwitches integration={i} />
            </Part>
          )}
          {logged && (
            <Collapsible title={t("integrations:card.log")} className="mt-5">
              <SyncLog
                id={i.id}
                types={i.policies.map((p) => p.type).filter((c) => !isAction(c))}
              />
            </Collapsible>
          )}
        </div>
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
      <DefaultSlicer integration={i} />
    </div>
  );
}

/** "Make default slicer" when more than one integration can open or slice files. */
function DefaultSlicer({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const savePrefs = useSavePreferences();
  const defaultId = usePreferences().data?.values.defaultSlicerId;
  const openers = useCapable("openInSlicer");
  const slicers = [
    ...openers,
    ...useCapable("slice").filter((s) => !openers.some((o) => o.id === s.id)),
  ];
  // The default is the chosen one if it still works, else the first (same rule as the server).
  const current = slicers.find((s) => s.id === defaultId) ?? slicers[0];
  if (slicers.length < 2 || !slicers.some((s) => s.id === i.id)) return null;
  return current?.id === i.id ? (
    <p className="text-muted">{t("integrations:slicer.isDefault")}</p>
  ) : (
    <Button
      className="justify-self-start"
      disabled={savePrefs.isPending}
      onClick={() => savePrefs.mutate({ defaultSlicerId: i.id })}
    >
      {t("integrations:slicer.makeDefault")}
    </Button>
  );
}

// Local state, not the URL: every integration card has its own log.
export function SyncLog({ id, types }: { id: string; types: SyncRun["type"][] }) {
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
