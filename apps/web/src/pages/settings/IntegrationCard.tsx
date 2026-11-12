import {
  type Integration,
  type IntegrationStatus,
  isAction,
  type LibrarySources,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  type SyncRun,
  syncRunFilters,
  workerConfigSchema,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable, type ListQuery } from "../../components/DataTable.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Menu } from "../../components/Menu.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { Switch } from "../../components/Switch.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import { formatDate, formatDateTime, formatRelative } from "../../lib/format.ts";
import { useDevices } from "../../lib/hub.ts";
import {
  libraryOf,
  useAdapterName,
  useAdapters,
  useCreateIntegration,
  useDefaultLibrary,
  useDeleteIntegration,
  useIntegrations,
  useLocationLabel,
  usePatchIntegration,
  usePickHubSlicer,
  useSyncIntegration,
  useSyncRuns,
} from "../../lib/integrations.ts";
import { useSavePreferences } from "../../lib/preferences.ts";
import { useCatalogSources } from "../../lib/presets.ts";
import { CAPS, ERRORS, LOCATION_ICONS } from "./integrationLabels.ts";
import { ManagedSlicer } from "./ManagedSlicer.tsx";
import { ActionSwitches } from "./PolicyRow.tsx";
import { SourceBadge, SyncSources } from "./Sources.tsx";
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

// The line from a row's node down to the next one's.
const RAIL =
  "relative grid scroll-mt-4 grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 py-3 before:absolute before:top-13 before:-bottom-4 before:left-4.5 before:w-px before:bg-border last:before:hidden";
const NODE = "relative mt-1 grid size-9 place-items-center rounded-md border";

// Literal keys so `pnpm i18n:check` sees them.
const PICK_ERRORS: Record<string, string> = {
  device_offline: "integrations:hub.errors.device_offline",
  device_outdated: "integrations:hub.errors.device_outdated",
  device_timeout: "integrations:hub.errors.device_timeout",
  not_an_option: "integrations:hub.errors.not_an_option",
  slicer_exists: "integrations:hub.errors.slicer_exists",
};

/**
 * The default slicer is a slicer type (ADR-0022), shown when there is more than one: its hub's
 * slicer is saved, else its install on this computer that opens files.
 */
function DefaultSlicer({ library, rows }: { library: string; rows: Integration[] }) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const save = useSavePreferences();
  const list = useIntegrations().data ?? [];
  const chosen = useDefaultLibrary();
  const can = (i: Integration) =>
    i.capabilities.includes("slice") || i.capabilities.includes("openInSlicer");
  const types = [...new Set(list.filter(can).map(libraryOf))];
  // The chosen one while it still works, else the first (the server's rule).
  const current = chosen && types.includes(chosen) ? chosen : types[0];
  const target = rows.find((i) => i.capabilities.includes("slice")) ?? rows.find(can);
  if (types.length < 2 || !target) return null;
  if (current === library) return <SourceBadge>{t("integrations:slicer.isDefault")}</SourceBadge>;
  return admin ? (
    <Button
      variant="ghost"
      disabled={save.isPending}
      onClick={() => save.mutate({ defaultSlicerId: target.id })}
    >
      {t("integrations:slicer.makeDefault")}
    </Button>
  ) : null;
}

/**
 * One card per slicer type (ADR-0022), or an API's that has no accounts card: its name, the default
 * slicer, its import cards' summary, and every install of it. For integrations.manage the installs
 * are the hub's slicer's choices; a machine's is set up here too.
 */
export function LibraryCard({ library, rows }: { library: string; rows: Integration[] }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const admin = useCan("integrations.manage");
  // No rows: a slicer type that only installs on machines so far.
  const slicer = !rows.length || rows.some((i) => i.kind !== "cloud");
  const here = rows.filter((i) => i.kind !== "worker" && i.kind !== "cloud");
  // A slicer type: it has a hub's slicer (a mock source or an API has none).
  const adapters = (useAdapters().data ?? []).filter((a) => a.libraryId === library);
  const type = adapters.length > 0;
  const lib = useCatalogSources(admin && type).data?.find((l) => l.library === library);
  return (
    <section
      aria-labelledby={`library-${library}`}
      className="rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={`library-${library}`} className="scroll-mt-4 text-lg font-semibold">
              {adapterName(library)}
            </h2>
            <DefaultSlicer library={library} rows={rows} />
          </div>
        </div>
        {admin && slicer && !here.length && (
          <Link to="/integrations/new" search={{ product: library }} className={addClass}>
            <Plus aria-hidden className="size-4" />
            {t("integrations:card.addLocation")}
          </Link>
        )}
      </div>
      {here.length > 1 && (
        <p role="note" className="mt-2 text-warn">
          {t("integrations:card.twoInstalls")}
        </p>
      )}
      {admin && type ? (
        <HubSlicer library={library} rows={rows} lib={lib} />
      ) : (
        <ul className="mt-2">
          {rows.map((i) => (
            <IntegrationCard key={i.id} integration={i} />
          ))}
        </ul>
      )}
      {/* For the whole slicer type: its installs all feed the same Sources tabs. */}
      <SyncSources
        types={[
          ...rows.flatMap((i) => i.policies.map((p) => p.type)),
          ...adapters.flatMap((a) => a.capabilities),
        ]}
      />
    </section>
  );
}

const deviceOf = (i: Integration) =>
  i.kind === "worker" ? workerConfigSchema.safeParse(i.config).data?.deviceId : undefined;

/**
 * The hub's slicer (ADR-0022), on a panel of its own, and Change slicer machine below it: a dialog
 * that picks among the enabled installs and says what the change does. Then the installs, each with
 * its setup; a machine that has the slicer without one gets Set up, any other is in Add a machine.
 */
function HubSlicer({
  library,
  rows,
  lib,
}: {
  library: string;
  rows: Integration[];
  lib: LibrarySources | undefined;
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const locationLabel = useLocationLabel();
  const legend = useId();
  const hubHeading = useId();
  const worker = useAdapters().data?.find((a) => a.kind === "worker" && a.libraryId === library);
  const devices = useDevices().data ?? [];
  const pick = usePickHubSlicer(library);
  const create = useCreateIntegration();
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState("");
  const current = rows.find((i) => i.id === lib?.cardsOf);
  // A switched-off install is never an option (the server agrees).
  const pickable = (i: Integration) =>
    i.enabled &&
    !!lib?.options.some((o) =>
      "integrationId" in o ? o.integrationId === i.id : o.deviceId === deviceOf(i),
    );
  const withRow = new Set(rows.flatMap((i) => deviceOf(i) ?? []));
  const setUp = (deviceId: string) => {
    if (!worker) return;
    const found = devices.find((d) => d.id === deviceId)?.slicers.some((s) => s.id === library);
    create.mutate({
      adapterId: worker.id,
      config: { deviceId, source: found ? "installed" : "managed" },
    });
  };
  const offered = (lib?.machines ?? []).filter((m) => m.slicer && !withRow.has(m.deviceId));
  const more = worker
    ? devices.filter((d) => !withRow.has(d.id) && !offered.some((m) => m.deviceId === d.id))
    : [];
  const error = pick.error ?? create.error;
  const code = error instanceof ApiError && error.code ? PICK_ERRORS[error.code] : undefined;
  const others = rows.filter((i) => i.id !== current?.id && pickable(i));
  const chosen = others.find((i) => i.id === choice) ?? others[0];
  const optionLabel = (i: Integration) =>
    i.slicerVersion
      ? t("integrations:hub.option", { where: locationLabel(i), version: i.slicerVersion })
      : locationLabel(i);
  const CurrentIcon = current && LOCATION_ICONS[current.kind];
  return (
    <>
      <section aria-labelledby={hubHeading} className="mt-4 grid gap-2 border-t border-border pt-4">
        <h3 id={hubHeading} className="font-semibold">
          {t("integrations:hub.title")}
        </h3>
        {current && CurrentIcon ? (
          // The one bold thing on the card: which install slices for the hub.
          <div className="flex min-w-0 items-start gap-3 rounded-lg border border-accent/40 bg-accent/10 p-3">
            <span
              aria-hidden
              className={cx(NODE, "mt-0 shrink-0 border-accent bg-accent text-accent-fg")}
            >
              <CurrentIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold wrap-anywhere">
                {locationLabel(current)}
                {current.slicerVersion && (
                  <span className="ml-2 font-normal text-muted">
                    {t("integrations:hub.version", { version: current.slicerVersion })}
                  </span>
                )}
              </p>
              <p className="text-muted">{t("integrations:hub.isHub")}</p>
            </div>
          </div>
        ) : (
          <p className="text-muted">
            {t(
              rows.length || offered.length ? "integrations:hub.noneYet" : "integrations:hub.none",
            )}
          </p>
        )}
        {others.length > 0 && (
          <div>
            <Button
              disabled={pick.isPending}
              onClick={() => {
                pick.reset();
                setChoice("");
                setChanging(true);
              }}
            >
              {t("integrations:hub.changeMachine")}
            </Button>
          </div>
        )}
        <p className="max-w-prose text-sm text-muted">{t("integrations:hub.hint")}</p>
      </section>
      <section aria-labelledby={legend} className="mt-4 grid min-w-0 gap-1">
        <h3 id={legend} className="font-semibold">
          {t("integrations:hub.installs")}
        </h3>
        <ul>
          {rows.map((i) => (
            <IntegrationCard
              key={i.id}
              integration={i}
              hub={{
                checked: lib?.cardsOf === i.id,
                notOffered: i.kind === "worker" && !pickable(i),
              }}
            />
          ))}
          {offered.map((m) => (
            <li key={m.deviceId} className={RAIL}>
              <span aria-hidden className={cx(NODE, "border-dashed border-border text-muted")}>
                <LOCATION_ICONS.worker className="size-4" />
              </span>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="flex min-h-11 items-center font-semibold wrap-anywhere">{m.name}</p>
                  <p className="text-muted">{t("integrations:hub.offers")}</p>
                </div>
                {worker && (
                  <Button disabled={create.isPending} onClick={() => setUp(m.deviceId)}>
                    {t("integrations:hub.setUp")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {more.length > 0 && (
          <div className="sm:max-w-sm">
            <Combobox
              aria-label={t("integrations:hub.addMachine")}
              value=""
              disabled={create.isPending}
              options={[
                { value: "", label: t("integrations:hub.addMachine") },
                ...more.map((d) => ({ value: d.id, label: d.name })),
              ]}
              onChange={(v) => v && setUp(v)}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-bad">
            {t(code ?? "integrations:card.actionError")}
          </p>
        )}
        {/* Another install changes the catalog, and every receiver gets the new one: it says so. */}
        <ConfirmDialog
          open={changing && !!chosen}
          title={t("integrations:hub.changeTitle", { name: adapterName(library) })}
          description={
            chosen?.slicerVersion && current?.slicerVersion === chosen.slicerVersion
              ? t("integrations:hub.pickBodySame")
              : current?.slicerVersion && chosen?.slicerVersion
                ? t("integrations:hub.pickBody", {
                    from: current.slicerVersion,
                    to: chosen.slicerVersion,
                  })
                : t("integrations:hub.pickBodyUnknown")
          }
          confirmLabel={t("integrations:hub.pick")}
          onCancel={() => setChanging(false)}
          onConfirm={() => {
            if (chosen) pick.mutate(chosen.id);
            setChanging(false);
          }}
        >
          <FormField label={t("integrations:hub.machine")}>
            {(p) => (
              <Combobox
                {...p}
                value={chosen?.id ?? ""}
                options={others.map((i) => ({ value: i.id, label: optionLabel(i) }))}
                onChange={setChoice}
              />
            )}
          </FormField>
        </ConfirmDialog>
      </section>
    </>
  );
}

/** A row on its slicer type's card: whether it is the hub's slicer, or a machine not offering it. */
type HubRole = { checked: boolean; notOffered: boolean };

/**
 * One place a slicer runs (or an account): where, on/off and a status line; then its account
 * (cloud) or slicer. `hub`: its role on its slicer type's card.
 */
export function IntegrationCard({
  integration: i,
  hub,
}: {
  integration: Integration;
  hub?: HubRole;
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const locationLabel = useLocationLabel();
  const adapter = useAdapters().data?.find((a) => a.id === i.adapterId);
  // An editor gets the status line and their task rows only (ADR-0012). Accounts have their own
  // card (AccountCard.tsx).
  const admin = useCan("integrations.manage");
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
  const H = hub ? "h4" : "h3";

  // The status line: one sentence for where the integration stands.
  const state = !i.enabled ? "disabled" : sync.isPending ? "syncing" : i.status;
  // A machine's install with its program set that isn't the hub's slicer: it gets the system presets
  // (and slices) only once it is picked, so nothing is missing yet.
  const standby =
    state === "unavailable" && i.kind === "worker" && !!i.slicerPath && !!hub && !hub.checked;
  const status =
    state === "disabled" ? (
      t("integrations:card.disabledHint")
    ) : state === "syncing" ? (
      t("integrations:card.syncing")
    ) : state === "unavailable" ? (
      i.kind === "server" ? (
        t("integrations:managed.notInstalledHint")
      ) : i.kind === "worker" ? (
        // Its program is picked, or the hub has no system presets for it yet: one sentence each.
        t(
          standby
            ? "integrations:worker.standbyHint"
            : i.slicerPath
              ? "integrations:worker.noPresetsHint"
              : "integrations:worker.unavailableHint",
        )
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
    <li id={`integration-${i.id}`} className={RAIL}>
      {/* The hub's slicer's node is filled, as on its panel above; a machine not offering it, dashed. */}
      <span
        aria-hidden
        className={cx(
          NODE,
          hub?.checked
            ? "border-accent bg-accent text-accent-fg"
            : "border-border bg-surface-2 text-muted",
          hub?.notOffered && "border-dashed",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <H className="flex min-w-0 flex-wrap items-center gap-x-2 text-base font-semibold">
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
            {i.slicerVersion && (
              <span className="text-sm font-normal text-muted">
                {t("integrations:hub.version", { version: i.slicerVersion })}
              </span>
            )}
            {hub?.checked && <SourceBadge>{t("integrations:hub.title")}</SourceBadge>}
          </H>
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
          <span
            aria-hidden
            className={cx("mt-1.5 size-2 shrink-0 rounded-full", DOT[standby ? "new" : state])}
          />
          <span>{status}</span>
        </p>
        {hub?.notOffered && <p className="text-muted">{t("integrations:hub.notOffered")}</p>}
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
              <ActionSwitches integration={i} />
            </Part>
          )}
          {admin && i.enabled && i.kind === "worker" && adapter && (
            <Part title={t("integrations:slicer.title")}>
              <WorkerSlicer integration={i} adapter={adapter} />
            </Part>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={t("integrations:deleteDialog.title", { name })}
        description={t(
          i.kind === "worker"
            ? "integrations:deleteDialog.workerBody"
            : "integrations:deleteDialog.body",
        )}
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
    </div>
  );
}

// Local state, not the URL: every integration card has its own log.
/** An integration's runs; `type`: only that type's, to start with. */
export function SyncLog({
  id,
  types,
  type,
}: {
  id: string;
  types: SyncRun["type"][];
  type?: string;
}) {
  const { t } = useTranslation();
  const [start] = useState<ListQuery>({ pageSize: "10", ...(type && { type }) });
  const [query, setQuery] = useState(start);
  const { data } = useSyncRuns(id, query);
  const rangeLabel = (r: SyncRun) => {
    const [from, to] = [r.rangeFrom, r.rangeTo].map((d) => (d ? formatDate(d) : ""));
    if (from && to) return t("integrations:runs.rangeBetween", { from, to });
    if (from) return t("integrations:runs.rangeFrom", { from });
    if (to) return t("integrations:runs.rangeTo", { to });
    return "–";
  };
  if (!data) return null;
  if (!data.total && query === start)
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
