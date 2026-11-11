import {
  accountMode,
  defaultPolicy,
  type Integration,
  isCatalogType,
  type SyncPolicy,
  type SyncRun,
} from "@3d-maker-suite/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { Cable, TriangleAlert } from "lucide-react";
import { useState } from "react";
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
  useAdapterName,
  useIntegrations,
  useMayTask,
  usePatchIntegration,
  useSyncIntegration,
} from "../../lib/integrations.ts";
import { Avatar } from "./AccountCard.tsx";
import { SyncLog } from "./IntegrationCard.tsx";
import { CAPS } from "./integrationLabels.ts";
import {
  LastSync,
  mergeLabel,
  PolicyEditDialog,
  ReviewPeriod,
  scopeLabel,
  useRunPolicy,
  useSummary,
} from "./PolicyRow.tsx";
import { SourceBlock, SourcesSection, type StateLine } from "./Sources.tsx";

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
  when: "min-w-48",
  what: "inline-block min-w-44",
  how: "inline-block min-w-48",
};
// Prints and spools both take the filament a print used: one of them should (`doubleTracking`).
const OTHER: Partial<Record<string, AccountType>> = { prints: "spools", spools: "prints" };

/** What a block calls the account: its email, else its name. */
export const accountName = (i: Integration) => i.account?.email || i.account?.name || null;

/** A block's title for an account: "Bambu Cloud · ana@example.com". */
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

/**
 * Printers, Prints or Filament settings → Sources: Share to the hub, one block per account that
 * allows the type, one line each (ADR-0021 wireframe 3). Without the settings, only the accounts
 * with a task of the caller's (ADR-0012).
 */
export function AccountSources({ type, settings }: { type: AccountType; settings: boolean }) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const may = useMayTask();
  const { data } = useIntegrations();
  if (!data) return null;
  const rows = data.filter((i) => feeds(i, type) && (settings || may(i.id, type, "any")));
  if (!rows.length)
    return (
      <EmptyState
        icon={Cable}
        title={t(EMPTY[type].title)}
        description={t(EMPTY[type].body)}
        action={admin && <IntegrationsLink />}
      />
    );
  return (
    <SourcesSection direction="share">
      {rows.map((i) => (
        <AccountBlock key={i.id} integration={i} types={[type]} />
      ))}
    </SourcesSection>
  );
}

/** The empty state's way to Integrations, where a source allows a type. */
export function IntegrationsLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/integrations"
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
  /** In place of the lines, e.g. a slicer heading around them. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const account = i.account;
  const title = useAccountTitle()(i);
  // `hasSecrets` is an admin's; anyone sees an expired sign-in.
  const signedOut =
    (admin && !i.hasSecrets) || i.lastError === "auth_expired" || i.lastError === "auth_required";
  if (!i.policies.some((p) => types.includes(p.type))) return null;
  const prints = types.length === 1 && types[0] === "prints";
  return (
    <SourceBlock
      // Its lines' anchors (`source-<id>-<type>`, an alert's link) open it.
      id={`source-${i.id}`}
      icon={<Avatar integration={i} text={account?.name || account?.email || title} />}
      title={title}
      badge={
        signedOut && (
          <span className="inline-block shrink-0 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
            {t("integrations:account.signedOut")}
          </span>
        )
      }
      link={
        admin
          ? {
              to: "/integrations",
              hash: `integration-${i.id}`,
              label: t("settings:sources.toAccount"),
            }
          : undefined
      }
    >
      {children ?? (
        // Prints never change once imported: nothing to choose about what or how.
        <PolicyLines integration={i} types={types} title={title} what={!prints} how={!prints} />
      )}
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
  const rows = types.flatMap(
    (type) => i.policies.find((p) => p.type === type && (admin || may(i.id, type, "any"))) ?? [],
  );
  if (!rows.length) return null;
  const name = (type: LineType) => t(CAPS[type]);
  // An account's types run on a schedule; a slicer's follow its files (ADR-0019).
  const files = i.kind !== "cloud";
  const mode = (type: LineType) => (files ? defaultPolicy(type).mode : accountMode(type));
  const failed = patch.isError || sync.isError || sync.data?.status === "error";
  const edited = rows.find((p) => p.type === editing);
  const other = edited && OTHER[edited.type];
  const otherTracks =
    !!other && i.policies.some((x) => x.type === other && x.mode !== "off" && x.trackUsage);

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
          <Button variant="ghost" className={item} disabled={sync.isPending} onClick={run}>
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
