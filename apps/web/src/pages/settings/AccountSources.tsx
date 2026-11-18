import {
  accountMode,
  defaultPolicy,
  type Integration,
  isCatalogType,
  isSlicerKind,
  printsLineOf,
  type SyncPolicy,
  type SyncRun,
} from "@3d-maker-suite/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { Cable, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Menu } from "../../components/Menu.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useCan } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import {
  type AccountType,
  feeds,
  isNetworkRow,
  useAdapterName,
  useAdapters,
  useIntegrations,
  useMayTask,
  usePatchIntegration,
  useSourceActivity,
  useSyncIntegration,
} from "../../lib/integrations.ts";
import { usePrinters } from "../../lib/printers.ts";
import { Avatar } from "./AccountCard.tsx";
import { SyncLog } from "./IntegrationCard.tsx";
import { CAPS, ERRORS } from "./integrationLabels.ts";
import {
  LastSync,
  mergeLabel,
  PolicyEditDialog,
  ReviewPeriod,
  scopeLabel,
  useRunPolicy,
  useSummary,
} from "./PolicyRow.tsx";
import { LINE_COLUMNS, SourceBlock, type StateLine } from "./Sources.tsx";

// Written out so `pnpm i18n:check` sees the keys.
const EMPTY: Record<AccountType, { title: string; body: string }> = {
  printers: {
    title: "settings:sources.empty.printers",
    body: "settings:sources.empty.printersBody",
  },
  prints: { title: "settings:sources.empty.prints", body: "settings:sources.empty.printsBody" },
  spools: { title: "settings:sources.empty.spools", body: "settings:sources.empty.spoolsBody" },
};
// Each block is its own table: the same widths keep the columns in line from one to the next.
export const COL = {
  item: "min-w-44",
  // Cells never wrap (DataTable), so the schedule wraps itself: else it runs over the next column.
  when: "min-w-48 whitespace-normal",
  what: "inline-block min-w-44",
  how: "inline-block min-w-48",
};
/**
 * Another line, of any source, that also sets the weight of the spools a line tracks usage for
 * (`doubleTracking`): prints and spools both take the filament a print used, and two spool
 * libraries both set a spool that is in both. Two prints lines don't: each has its printers.
 */
export function otherTracking(
  all: Integration[],
  integrationId: string,
  type: string,
): "prints" | "spools" | undefined {
  const tracking = all.flatMap((j) => {
    const line = isNetworkRow(j) ? printsLineOf(j.policies.map((p) => p.type)) : undefined;
    return j.policies.flatMap((p) => {
      // A network printer's prints line records live, with its history switched off too.
      const live = p.type === line && p.type === "prints";
      const on = (p.mode !== "off" || live) && p.recordPrints;
      return on && p.trackUsage && !(j.id === integrationId && p.type === type)
        ? [p.type === line ? "prints" : p.type]
        : [];
    });
  });
  const has = (t: "prints" | "spools") => (tracking.includes(t) ? t : undefined);
  if (type === "spools") return has("spools") ?? has("prints");
  return type === "prints" || type === "printerStatus" ? has("spools") : undefined;
}

/** What a source calls the account: its name, else its email. */
export const accountName = (i: Integration) => i.account?.name || i.account?.email || null;

/** A source's title for an account: "Bambu Cloud · Ana". */
export function useAccountTitle() {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  return (i: Integration) => {
    const name = accountName(i);
    return name
      ? t("settings:sources.account", { adapter: adapterName(i.adapterId), account: name })
      : adapterName(i.adapterId);
  };
}

/** One source of a Sources table: its line of the page's type and what the row calls it. */
type SourceRow = {
  integration: Integration;
  /** The tab it is listed on; a live-only printer's `policy` is its `printerStatus` line. */
  page: AccountType;
  /** A network printer on Prints: its switch is Record prints. */
  records: boolean;
  policy: SyncPolicy;
  /** The source in full, for the row's labels. */
  title: string;
  /** Under the source type: the account, or the printer a network source is. */
  name: string | null;
};

/**
 * Printers, Prints or Filament settings → Sources: one table with a row per source of the type
 * (ADR-0021 wireframe 3, 6.1.0 Step 18). Only the sources the caller may manage or has a task on
 * (ADR-0012).
 */
export function AccountSources({ type }: { type: AccountType }) {
  const { t, i18n } = useTranslation();
  const admin = useCan("integrations.manage");
  const may = useMayTask();
  const adapterName = useAdapterName();
  const titleOf = useAccountTitle();
  const { data } = useIntegrations();
  const listed = (data ?? []).filter((i) => feeds(i, type) && may(i.id, type, "any"));
  // A network source is named by its printer. Someone who can't read printers sees the type alone.
  const printers = usePrinters({
    archived: "all",
    enabled: listed.some((i) => i.printerId),
  }).data?.items;
  if (!data) return null;
  if (!listed.length)
    return (
      <EmptyState
        icon={Cable}
        title={t(EMPTY[type].title)}
        description={t(EMPTY[type].body)}
        action={admin && <IntegrationsLink />}
      />
    );
  const { compare } = new Intl.Collator(i18n.resolvedLanguage);
  const rows = listed
    .flatMap((integration): SourceRow[] => {
      const records = type === "prints" && isNetworkRow(integration);
      const line = records ? printsLineOf(integration.policies.map((p) => p.type)) : type;
      const policy = integration.policies.find((p) => p.type === line);
      if (!policy) return [];
      const printer = printers?.find((p) => p.id === integration.printerId)?.name;
      return [
        {
          integration,
          page: type,
          records,
          policy,
          title: titleOf(integration),
          name: accountName(integration) ?? printer ?? null,
        },
      ];
    })
    .sort(
      (a, b) =>
        compare(adapterName(a.integration.adapterId), adapterName(b.integration.adapterId)) ||
        compare(a.name ?? "", b.name ?? ""),
    );
  // Prints never change once imported: nothing to choose about what or how.
  const options = type !== "prints";
  return (
    <DataTable
      label={t("settings:sources.table", { type: t(CAPS[type]) })}
      rows={rows}
      rowKey={(r) => r.integration.id}
      columns={[
        {
          id: "source",
          header: t("settings:sources.columns.source"),
          className: LINE_COLUMNS.item,
          cell: (r) => <SourceCell row={r} />,
        },
        {
          id: "on",
          header: t("settings:sources.columns.on"),
          className: LINE_COLUMNS.on,
          cell: (r) => <SourceSwitch row={r} />,
        },
        {
          id: "when",
          header: t("settings:sources.columns.when"),
          cell: (r) => <SourceWhen row={r} />,
        },
        ...(options
          ? [
              {
                id: "what",
                header: t("settings:sources.columns.what"),
                cell: (r: SourceRow) => (
                  <span className={ROW_TEXT}>
                    {r.policy.mode !== "off" && t(scopeLabel(r.policy.scope))}
                  </span>
                ),
              },
              {
                id: "how",
                header: t("settings:sources.columns.how"),
                cell: (r: SourceRow) => (
                  <span className={ROW_TEXT}>
                    {r.policy.mode !== "off" && t(mergeLabel(r.policy.merge))}
                  </span>
                ),
              },
            ]
          : []),
        {
          id: "actions",
          header: t("settings:sources.columns.actions"),
          headerCell: <span className="sr-only">{t("settings:sources.columns.actions")}</span>,
          className: LINE_COLUMNS.actions,
          cell: (r) => <SourceActions row={r} />,
        },
      ]}
    />
  );
}

// Cells never wrap (DataTable); these do, so the table fits a laptop.
const ROW_TEXT = "inline-block min-w-32 whitespace-normal";
const BADGE = "inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium";

/**
 * Who the source is, on two lines: its type, then its account or printer. What needs attention
 * follows the type as badges, so a healthy row stays quiet.
 */
function SourceCell({
  row: { integration: i, page, records, policy: p, title, name },
}: {
  row: SourceRow;
}) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const adapterName = useAdapterName();
  const signedOut = useSignedOut()(i);
  const { failed } = useSourceActivity(i.id);
  const anchor = `source-${i.id}-${page}`;
  const paused = records ? !p.recordPrints : p.mode === "off";
  const root = useRef<HTMLDivElement>(null);
  // An alert's link: the row only exists once the list is in.
  useEffect(() => {
    if (location.hash === `#${anchor}`) root.current?.scrollIntoView({ block: "center" });
  }, [anchor]);
  const type = adapterName(i.adapterId);
  const error = !signedOut && i.status === "error";
  const reason = error && i.lastError ? t(ERRORS[i.lastError]) : undefined;
  const through = i.viaDeviceName;
  return (
    <div
      ref={root}
      id={anchor}
      className="grid min-w-52 scroll-mt-4 gap-0.5 whitespace-normal py-1.5"
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {admin ? (
          <Link
            to="/settings/integrations"
            hash={`integration-${i.id}`}
            aria-label={t("settings:sources.toIntegration", { source: title })}
            className="wrap-anywhere font-medium underline-offset-2 hover:underline"
          >
            {type}
          </Link>
        ) : (
          <span className="wrap-anywhere font-medium">{type}</span>
        )}
        {signedOut && <SignedOutBadge integration={i} title={title} />}
        {error && (
          <span title={reason} className={cx(BADGE, "bg-bad/15 text-bad")}>
            {t("integrations:fold.error")}
            {reason && <span className="sr-only"> {reason}</span>}
          </span>
        )}
        {paused && (
          <span className={cx(BADGE, "bg-warn/15 text-warn")}>{t("integrations:fold.paused")}</span>
        )}
        {p.pending > 0 && p.mode !== "off" && !paused && (
          <span className={cx(BADGE, "bg-warn/15 text-warn")}>
            {t("integrations:policies.pending", { count: p.pending })}
          </span>
        )}
      </span>
      {(name || through) && (
        <span className="wrap-anywhere text-sm text-muted">
          {name ?? t("integrations:account.through", { machine: through })}
        </span>
      )}
      {failed && (
        <span role="alert" className="text-sm text-bad">
          {t("integrations:card.actionError")}
        </span>
      )}
    </div>
  );
}

/**
 * A row's switch: off is the policy `off`; on again, the type's default mode. A network printer's
 * is Record prints: its live status goes on either way.
 */
function SourceSwitch({ row: { integration: i, records, policy: p, title } }: { row: SourceRow }) {
  const { t } = useTranslation();
  const admin = useManagesLine(p.type);
  const patch = usePatchIntegration(i.id);
  if (records)
    return (
      <Switch
        label={t("settings:sources.recordOn", { source: title })}
        labelClassName="sr-only"
        checked={p.recordPrints}
        disabled={!admin || patch.isPending}
        onChange={(e) =>
          patch.mutate({ policies: [{ type: p.type, recordPrints: e.target.checked }] })
        }
      />
    );
  return (
    <Switch
      label={t("settings:sources.lineOn", { type: t(CAPS[p.type]), source: title })}
      labelClassName="sr-only"
      checked={p.mode !== "off"}
      disabled={!admin || patch.isPending}
      onChange={(e) =>
        patch.mutate({
          policies: [{ type: p.type, mode: e.target.checked ? accountMode(p.type) : "off" }],
        })
      }
    />
  );
}

/**
 * A row's schedule. A network printer that isn't reading its history says how its prints arrive
 * instead: live, not at all, or not while its live status is off.
 */
function SourceWhen({ row: { integration: i, records, policy: p } }: { row: SourceRow }) {
  const { t } = useTranslation();
  const { syncing } = useSourceActivity(i.id);
  const liveOn = i.policies.some((l) => l.type === "printerStatus" && l.mode !== "off");
  const noHistory = p.type === "printerStatus" || p.mode === "off";
  if (records && !p.recordPrints)
    return <span className={cx(COL.when, "grid py-1.5")}>{t("settings:sources.notRecorded")}</span>;
  if (records && noHistory)
    return (
      <span className={cx(COL.when, "grid py-1.5", !liveOn && "text-warn")}>
        {t(liveOn ? "settings:sources.recordedLive" : "settings:sources.liveOff")}
      </span>
    );
  return <When policy={p} files={false} syncing={syncing(p.type)} />;
}

/** A row's Edit and `⋯`, each only for who may use it. A live-only printer has nothing to run. */
function SourceActions({ row: { integration: i, page, policy: p, title } }: { row: SourceRow }) {
  const { t } = useTranslation();
  const admin = useManagesLine(p.type);
  const sync = useSyncIntegration(i.id);
  const [editing, setEditing] = useState(false);
  const { data: all } = useIntegrations();
  const name = t(CAPS[page]);
  return (
    <span className="flex items-center justify-end gap-1">
      {admin && (
        <Button
          aria-label={t("settings:sources.editOf", { type: name, source: title })}
          onClick={() => setEditing(true)}
        >
          {t("settings:sources.edit")}
        </Button>
      )}
      {p.type !== "printerStatus" ? (
        <LineMenu integration={i} policy={p} name={name} title={title} sync={sync} admin={admin} />
      ) : (
        // The width of the `⋯`, so Edit lines up with the rows that have one.
        <span aria-hidden className="size-9 shrink-0" />
      )}
      {editing && (
        <PolicyEditDialog
          integration={i}
          policy={p}
          title={t("settings:sources.editTitle", {
            type: name,
            source: accountName(i) ?? title,
          })}
          otherTracks={otherTracking(all ?? [i], i.id, p.type)}
          onClose={() => setEditing(false)}
        />
      )}
    </span>
  );
}

/**
 * Whether a source needs signing in again. Only a source with a sign-in can be signed out: a
 * printer without an API key has no secrets and nothing wrong. `hasSecrets` is an admin's; anyone
 * sees an expired sign-in.
 */
function useSignedOut() {
  const admin = useCan("integrations.manage");
  const adapters = useAdapters().data;
  return (i: Integration) =>
    (admin && !i.hasSecrets && !!adapters?.find((a) => a.id === i.adapterId)?.login) ||
    i.lastError === "auth_expired" ||
    i.lastError === "auth_required";
}

/** "Signed out": an admin fixes it on the account's Edit page (6.1.0 Step 10c). */
function SignedOutBadge({ integration: i, title }: { integration: Integration; title: string }) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  return admin ? (
    <Link
      to="/integrations/$id/edit"
      params={{ id: i.id }}
      aria-label={t("integrations:account.signedOutLink", { name: title })}
      className={cx(BADGE, "bg-warn/15 text-warn underline-offset-2 hover:underline")}
    >
      {t("integrations:account.signedOut")}
    </Link>
  ) : (
    <span className={cx(BADGE, "bg-warn/15 text-warn")}>{t("integrations:account.signedOut")}</span>
  );
}

/** The empty state's way to Integrations, where a source allows a type. */
export function IntegrationsLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/settings/integrations"
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 font-medium transition-colors hover:bg-surface-2"
    >
      <Cable className="size-4" aria-hidden="true" />
      {t("settings:sources.integrations")}
    </Link>
  );
}

/** One account's block: its photo, name and sign-in state, the link back, and its lines. */
export function AccountBlock({
  integration: i,
  types,
  children,
}: {
  integration: Integration;
  types: SyncPolicy["type"][];
  /** Its lines, e.g. under a slicer heading. */
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const account = i.account;
  const title = useAccountTitle()(i);
  const signedOut = useSignedOut()(i);
  if (!i.policies.some((p) => types.includes(p.type))) return null;
  return (
    <SourceBlock
      // Its lines' anchors (`source-<id>-<type>`, an alert's link) open it.
      id={`source-${i.id}`}
      icon={<Avatar integration={i} text={account?.name || account?.email || title} />}
      title={title}
      badge={signedOut && <SignedOutBadge integration={i} title={title} />}
      link={
        admin
          ? {
              to: "/settings/integrations",
              hash: `integration-${i.id}`,
              label: t("settings:sources.toAccount"),
            }
          : undefined
      }
    >
      {children}
    </SourceBlock>
  );
}

type LineType = SyncPolicy["type"];

/** Who edits a line: catalog and preset lines catalog manage (ADR-0020, ADR-0023). */
export const useManagesLine = (type: LineType) =>
  useCan(isCatalogType(type) ? "catalog" : "integrations.manage", "manage");

/** A machine's own switch on a line: it sends that kind or not. */
export type SendLine = NonNullable<StateLine["on"]>;

/**
 * A source's lines of one integration in one table: per type its switch, schedule, what and how,
 * Edit and `⋯` (ADR-0021). The switch off is the policy `off`; on again, the type's default mode.
 * Only the lines the caller may change or run. `send`: a machine's line whose switch is its send
 * of that kind; while it sends, When is the hub's import of it as on any line, else Off.
 */
export function PolicyLines({
  integration: i,
  types,
  title,
  what = true,
  how = true,
  send,
}: {
  integration: Integration;
  types: LineType[];
  /** The source, as its block names it. */
  title: string;
  what?: boolean;
  how?: boolean;
  send?: (type: LineType) => SendLine | undefined;
}) {
  const { t } = useTranslation();
  const admin = useManagesLine(types[0] ?? "printers");
  const may = useMayTask();
  const patch = usePatchIntegration(i.id);
  const sync = useSyncIntegration(i.id);
  const [editing, setEditing] = useState<LineType>();
  const { data: all } = useIntegrations();
  const rows = types.flatMap(
    (type) => i.policies.find((p) => p.type === type && (admin || may(i.id, type, "any"))) ?? [],
  );
  if (!rows.length) return null;
  const name = (type: LineType) => t(CAPS[type]);
  // An account's types run on a schedule; a slicer's follow its files (ADR-0019).
  const files = isSlicerKind(i.kind);
  const mode = (type: LineType) => (files ? defaultPolicy(type).mode : accountMode(type));
  const failed = patch.isError || sync.isError || sync.data?.status === "error";
  const edited = rows.find((p) => p.type === editing);
  const otherTracks = edited && otherTracking(all ?? [i], i.id, edited.type);

  return (
    <div
      id={types.length === 1 ? `source-${i.id}-${types[0]}` : undefined}
      className="grid scroll-mt-4 gap-2"
    >
      <DataTable
        label={t("settings:sources.lines", { source: title })}
        rows={rows}
        rowKey={(r) => r.type}
        columns={[
          {
            id: "item",
            header: t("settings:sources.columns.item"),
            className: LINE_COLUMNS.item,
            cell: (r) => (
              <span
                className={cx(COL.item, "inline-flex flex-wrap items-center gap-x-2 font-medium")}
              >
                {name(r.type)}
                {r.pending > 0 && r.mode !== "off" && (
                  <span className="inline-flex items-center gap-1 text-warn">
                    <TriangleAlert aria-hidden className="size-4 shrink-0" />
                    {t("integrations:policies.pending", { count: r.pending })}
                  </span>
                )}
              </span>
            ),
          },
          {
            id: "on",
            header: t("settings:sources.columns.on"),
            className: LINE_COLUMNS.on,
            cell: (r) => {
              const s = send?.(r.type);
              return s ? (
                <Switch
                  label={s.label}
                  labelClassName="sr-only"
                  checked={s.checked}
                  disabled={s.disabled}
                  onChange={(e) => s.set(e.target.checked)}
                />
              ) : (
                <Switch
                  label={t("settings:sources.lineOn", { type: name(r.type), source: title })}
                  labelClassName="sr-only"
                  checked={r.mode !== "off"}
                  disabled={!admin || patch.isPending}
                  onChange={(e) =>
                    patch.mutate({
                      policies: [{ type: r.type, mode: e.target.checked ? mode(r.type) : "off" }],
                    })
                  }
                />
              );
            },
          },
          {
            id: "when",
            header: t("settings:sources.columns.when"),
            // The schedule, and under it the last run: one column, so the line fits a laptop.
            cell: (r) => {
              const s = send?.(r.type);
              return s && !s.checked ? (
                <span className={cx(COL.when, "grid py-1.5")}>
                  {t("integrations:policies.modes.off")}
                </span>
              ) : (
                <When
                  policy={r}
                  files={files}
                  syncing={sync.isPending && sync.variables?.type === r.type}
                />
              );
            },
          },
          ...(what
            ? [
                {
                  id: "what",
                  header: t("settings:sources.columns.what"),
                  className: LINE_COLUMNS.what,
                  cell: (r: SyncPolicy) => (
                    <span className={COL.what}>{r.mode !== "off" && t(scopeLabel(r.scope))}</span>
                  ),
                },
              ]
            : []),
          ...(how
            ? [
                {
                  id: "how",
                  header: t("settings:sources.columns.how"),
                  cell: (r: SyncPolicy) => (
                    <span className={COL.how}>{r.mode !== "off" && t(mergeLabel(r.merge))}</span>
                  ),
                },
              ]
            : []),
          {
            id: "actions",
            header: t("settings:sources.columns.actions"),
            headerCell: <span className="sr-only">{t("settings:sources.columns.actions")}</span>,
            className: LINE_COLUMNS.actions,
            cell: (r) => (
              <span className="flex items-center justify-end gap-1">
                {admin && (
                  <Button
                    aria-label={t("settings:sources.editOf", { type: name(r.type), source: title })}
                    onClick={() => setEditing(r.type)}
                  >
                    {t("settings:sources.edit")}
                  </Button>
                )}
                <LineMenu
                  integration={i}
                  policy={r}
                  name={name(r.type)}
                  title={title}
                  sync={sync}
                  admin={admin}
                />
              </span>
            ),
          },
        ]}
      />
      {failed && (
        <p role="alert" className="text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}
      {edited && (
        <PolicyEditDialog
          integration={i}
          policy={edited}
          title={t("settings:sources.editTitle", {
            type: name(edited.type),
            source: accountName(i) ?? title,
          })}
          otherTracks={otherTracks}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

/** A line's schedule ("Automatic when the files change", "Auto, every day at 03:00") and last run. */
function When({
  policy: r,
  files,
  syncing,
}: {
  policy: SyncPolicy;
  files: boolean;
  syncing: boolean;
}) {
  const { t } = useTranslation();
  const summary = useSummary(r, files);
  return (
    <span className={cx(COL.when, "grid py-1.5")}>
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className={cx(
            "size-2 shrink-0 rounded-full",
            r.mode === "auto" ? "bg-ok" : r.mode === "off" ? "border border-muted" : "bg-border",
          )}
        />
        {syncing ? t("integrations:card.syncing") : summary}
      </span>
      <span className="ps-4 text-sm text-muted">
        <LastSync at={r.lastRunAt} />
      </span>
    </span>
  );
}

/** `⋯`: Sync now, Review and import (with its count), a period of prints, the sync log. */
function LineMenu({
  integration: i,
  policy: p,
  name,
  title,
  sync,
  admin,
}: {
  integration: Integration;
  policy: SyncPolicy;
  name: string;
  title: string;
  sync: ReturnType<typeof useSyncIntegration>;
  admin: boolean;
}) {
  const { t } = useTranslation();
  const { review, reviewOf, canSync, canReview, run } = useRunPolicy(i, p, sync);
  const [dialog, setDialog] = useState<"period" | "log">();
  const on = p.mode !== "off";
  const period = p.type === "prints" && canReview;
  // An off line can't run; its log still tells what it did.
  if (!(on && (canSync || canReview)) && !admin) return null;
  const item = "justify-start";
  return (
    <>
      <Menu label={t("settings:sources.menu", { type: name, source: title })}>
        {on && canSync && (
          <Button variant="ghost" className={item} busy={sync.isPending} onClick={run}>
            {t("integrations:policies.syncNow")}
          </Button>
        )}
        {on && review && canReview && (
          <Link
            {...review}
            className="inline-flex h-9 items-center rounded-md px-3 font-medium hover:bg-surface-2"
          >
            {p.pending > 0
              ? t("settings:sources.reviewCount", { count: p.pending })
              : t("integrations:policies.importNow")}
          </Link>
        )}
        {on && period && (
          <Button variant="ghost" className={item} onClick={() => setDialog("period")}>
            {t("settings:sources.reviewPeriod")}
          </Button>
        )}
        {admin && (
          <Button variant="ghost" className={item} onClick={() => setDialog("log")}>
            {t("integrations:card.log")}
          </Button>
        )}
      </Menu>
      <PeriodDialog
        open={dialog === "period"}
        lastRunAt={p.lastRunAt}
        onClose={() => setDialog(undefined)}
        reviewOf={reviewOf}
      />
      <AddDialog
        open={dialog === "log"}
        wide
        title={t("settings:sources.logTitle", { type: name, source: title })}
        onClose={() => setDialog(undefined)}
      >
        {/* A line is never an action (open in the slicer, slice): those are switches. */}
        <SyncLog id={i.id} types={[p.type as NonNullable<SyncRun["type"]>]} type={p.type} />
      </AddDialog>
    </>
  );
}

/** Prints: review every print of a period, imported or not. */
function PeriodDialog({
  open,
  lastRunAt,
  onClose,
  reviewOf,
}: {
  open: boolean;
  lastRunAt: string | null;
  onClose: () => void;
  reviewOf: ReturnType<typeof useRunPolicy>["reviewOf"];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <AddDialog open={open} title={t("integrations:sync.period")} onClose={onClose}>
      <div className="@container">
        <ReviewPeriod
          lastRunAt={lastRunAt}
          open={(dates) => {
            const target = reviewOf(dates);
            if (target) navigate(target);
          }}
        />
      </div>
    </AddDialog>
  );
}
