import { accountMode, type Integration, type SyncPolicy } from "@3d-maker-suite/core";
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
import { SourceBlock, SourcesSection } from "./Sources.tsx";

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
const COL = {
  item: "min-w-28",
  when: "min-w-48",
  what: "inline-block min-w-44",
  how: "inline-block min-w-48",
};
// Prints and spools both take the filament a print used: one of them should (`doubleTracking`).
const OTHER: Partial<Record<AccountType, AccountType>> = { prints: "spools", spools: "prints" };

/** What a block calls the account: its email, else its name. */
const accountName = (i: Integration) => i.account?.email || i.account?.name || null;

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
        action={
          admin && (
            <Link
              to="/integrations"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 font-medium transition-colors hover:bg-surface-2"
            >
              <Cable className="size-4" aria-hidden="true" />
              {t("settings:sources.integrations")}
            </Link>
          )
        }
      />
    );
  return (
    <SourcesSection direction="share">
      {rows.map((i) => (
        <AccountBlock key={i.id} integration={i} type={type} />
      ))}
    </SourcesSection>
  );
}

function AccountBlock({ integration: i, type }: { integration: Integration; type: AccountType }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const admin = useCan("integrations.manage");
  const account = i.account;
  const name = accountName(i);
  const title = name
    ? t("settings:sources.account", { adapter: adapterName(i.adapterId), account: name })
    : adapterName(i.adapterId);
  // `hasSecrets` is an admin's; anyone sees an expired sign-in.
  const signedOut =
    (admin && !i.hasSecrets) || i.lastError === "auth_expired" || i.lastError === "auth_required";
  const policy = i.policies.find((p) => p.type === type);
  if (!policy) return null;
  return (
    <SourceBlock
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
      <Line integration={i} policy={policy} type={type} title={title} />
    </SourceBlock>
  );
}

/** The account's one line: its switch, schedule, what and how, Edit and `⋯`. */
function Line({
  integration: i,
  policy: p,
  type,
  title,
}: {
  integration: Integration;
  policy: SyncPolicy;
  type: AccountType;
  title: string;
}) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const patch = usePatchIntegration(i.id);
  const sync = useSyncIntegration(i.id);
  const summary = useSummary(p, false);
  const [editing, setEditing] = useState(false);
  const name = t(CAPS[type]);
  const other = OTHER[type];
  const otherTracks =
    !!other && i.policies.some((x) => x.type === other && x.mode !== "off" && x.trackUsage);
  const failed = patch.isError || sync.isError || sync.data?.status === "error";
  const on = p.mode !== "off";

  return (
    <div id={`source-${i.id}-${type}`} className="grid scroll-mt-4 gap-2">
      <DataTable
        label={t("settings:sources.lines", { source: title })}
        rows={[p]}
        rowKey={(r) => r.type}
        columns={[
          {
            id: "item",
            header: t("settings:sources.columns.item"),
            cell: (r) => (
              <span className={cx(COL.item, "inline-flex items-center gap-2 font-medium")}>
                {name}
                {r.pending > 0 && on && (
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
            cell: () => (
              <Switch
                label={t("settings:sources.lineOn", { type: name, source: title })}
                labelClassName="sr-only"
                checked={on}
                disabled={!admin || patch.isPending}
                onChange={(e) =>
                  patch.mutate({
                    policies: [{ type, mode: e.target.checked ? accountMode(type) : "off" }],
                  })
                }
              />
            ),
          },
          {
            id: "when",
            header: t("settings:sources.columns.when"),
            // The schedule, and under it the last run: one column, so the line fits a laptop.
            cell: (r) => (
              <span className={cx(COL.when, "grid py-1.5")}>
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cx(
                      "size-2 shrink-0 rounded-full",
                      r.mode === "auto"
                        ? "bg-ok"
                        : r.mode === "off"
                          ? "border border-muted"
                          : "bg-border",
                    )}
                  />
                  {sync.isPending ? t("integrations:card.syncing") : summary}
                </span>
                <span className="ps-4 text-sm text-muted">
                  <LastSync at={r.lastRunAt} />
                </span>
              </span>
            ),
          },
          // Prints never change once imported: nothing to choose about what or how.
          ...(type === "prints"
            ? []
            : [
                {
                  id: "what",
                  header: t("settings:sources.columns.what"),
                  cell: (r: SyncPolicy) => (
                    <span className={COL.what}>{on && t(scopeLabel(r.scope))}</span>
                  ),
                },
                {
                  id: "how",
                  header: t("settings:sources.columns.how"),
                  cell: (r: SyncPolicy) => (
                    <span className={COL.how}>{on && t(mergeLabel(r.merge))}</span>
                  ),
                },
              ]),
          {
            id: "actions",
            header: t("settings:sources.columns.actions"),
            headerCell: <span className="sr-only">{t("settings:sources.columns.actions")}</span>,
            cell: (r) => (
              <span className="flex items-center justify-end gap-1">
                {admin && (
                  <Button
                    aria-label={t("settings:sources.editOf", { type: name, source: title })}
                    onClick={() => setEditing(true)}
                  >
                    {t("settings:sources.edit")}
                  </Button>
                )}
                <LineMenu
                  integration={i}
                  policy={r}
                  type={type}
                  name={name}
                  title={title}
                  sync={sync}
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
      {editing && (
        <PolicyEditDialog
          integration={i}
          policy={p}
          title={t("settings:sources.editTitle", { type: name, source: accountName(i) ?? title })}
          otherTracks={otherTracks}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/** `⋯`: Sync now, Review and import (with its count), a period of prints, the sync log. */
function LineMenu({
  integration: i,
  policy: p,
  type,
  name,
  title,
  sync,
}: {
  integration: Integration;
  policy: SyncPolicy;
  type: AccountType;
  name: string;
  title: string;
  sync: ReturnType<typeof useSyncIntegration>;
}) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const { review, reviewOf, canSync, canReview, run } = useRunPolicy(i, p, sync);
  const [dialog, setDialog] = useState<"period" | "log">();
  const on = p.mode !== "off";
  const period = type === "prints" && canReview;
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
        <SyncLog id={i.id} types={[type]} type={type} />
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
