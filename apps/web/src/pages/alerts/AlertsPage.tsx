import type {
  Alert,
  AlertModule,
  AlertSeverity,
  Capability,
  IntegrationErrorCode,
  ReviewedType,
  SyncLogEntry,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { BellOff, CircleAlert, CircleCheck, type LucideIcon, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { useAlertAction, useAlertDetail, useAlerts } from "../../lib/alerts.ts";
import { formatDateTime, formatWeight } from "../../lib/format.ts";
import { useAdapterName } from "../../lib/integrations.ts";
import { TITLE } from "../import/SourceReviewPage.tsx";
import { CAPS, ERRORS } from "../settings/IntegrationsPage.tsx";

export const SEVERITY: Record<AlertSeverity, { icon: LucideIcon; color: string; label: string }> = {
  error: { icon: CircleAlert, color: "text-bad", label: "alerts:severity.error" },
  warning: { icon: TriangleAlert, color: "text-warn", label: "alerts:severity.warning" },
  success: { icon: CircleCheck, color: "text-ok", label: "alerts:severity.success" },
};
export const MODULE: Record<AlertModule, string> = {
  filament: "nav:items.filament.label",
  maintenance: "nav:items.maintenance.label",
  printers: "nav:items.printers.label",
  integrations: "nav:items.integrations.label",
};
const LOG: Record<Exclude<SyncLogEntry["event"], "left">, string> = {
  created: "alerts:log.created",
  updated: "alerts:log.updated",
  invalid: "alerts:log.invalid",
  failed: "alerts:log.failed",
  truncated: "alerts:log.truncated",
};
const LEFT: Record<NonNullable<SyncLogEntry["reason"]>, string> = {
  pick: "alerts:log.left.pick",
  unsure: "alerts:log.left.unsure",
  review: "alerts:log.left.review",
};

const link = "font-medium hover:underline";
export const buttonLink =
  "inline-flex h-9 items-center whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

/** The alert's sentence. In the list it opens the alert; in the alert's own view, what it is about. */
export function Title({ a, inList }: { a: Alert; inList?: boolean }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const c = a.context;
  const type = t(CAPS[c.type as Capability] ?? "");
  const text = {
    spool_low: () =>
      t("alerts:kinds.spool_low", { name: c.name, grams: formatWeight(Number(c.grams)) }),
    maintenance_due: () =>
      t(
        a.severity === "error"
          ? "alerts:kinds.maintenance_overdue"
          : "alerts:kinds.maintenance_due",
        { task: c.task, printer: c.printer },
      ),
    warranty_ending: () =>
      t("alerts:kinds.warranty_ending", { name: c.name, count: Number(c.days) }),
    sync_pending: () =>
      t("alerts:kinds.sync_pending", {
        name: adapterName(String(c.adapterId)),
        type: t(TITLE[c.type as ReviewedType] ?? ""),
        count: Number(c.count),
      }),
    sync_success: () =>
      t("alerts:kinds.sync_success", {
        name: adapterName(String(c.adapterId)),
        type,
        count: Number(c.created),
        updated: c.updated,
      }),
    sync_error: () =>
      t("alerts:kinds.sync_error", {
        name: adapterName(String(c.adapterId)),
        type,
        reason: t(ERRORS[c.code as IntegrationErrorCode] ?? ERRORS.unknown),
      }),
  }[a.kind]();
  if (inList)
    return (
      <Link to="/alerts/$id" params={{ id: a.id }} className={link}>
        {text}
      </Link>
    );
  switch (a.kind) {
    case "spool_low":
      return (
        <Link to="/filament/spools/$id" params={{ id: a.entityId }} className={link}>
          {text}
        </Link>
      );
    case "warranty_ending":
      return (
        <Link to="/printers/$id" params={{ id: a.entityId }} className={link}>
          {text}
        </Link>
      );
    case "maintenance_due":
      return (
        <Link to="/maintenance" className={link}>
          {text}
        </Link>
      );
    case "sync_success":
    case "sync_error":
      return (
        <Link to="/integrations" className={link}>
          {text}
        </Link>
      );
    default:
      return <span className="font-medium">{text}</span>;
  }
}

export function LogList({ log }: { log: SyncLogEntry[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-1 space-y-0.5 text-muted">
      {log.map((e, i) => (
        // Log lines have no id and never reorder.
        <li key={i} className={e.event === "failed" ? "text-bad" : undefined}>
          {t(e.event === "left" ? LEFT[e.reason ?? "review"] : LOG[e.event], {
            label: e.label ?? t("alerts:log.noName"),
            count: e.count,
            reason: t(ERRORS[e.code ?? "unknown"]),
          })}
        </li>
      ))}
    </ul>
  );
}

/** A sync run's log, loaded when opened. */
function Detail({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useAlertDetail(id, open);
  return (
    <details className="mt-1" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-muted hover:text-text">{t("alerts:details")}</summary>
      {data?.detail && <LogList log={data.detail.log} />}
    </details>
  );
}

/** Read, snooze and dismiss: the same on the list and in the alert's own view. */
export function AlertButtons({
  a,
  snoozed,
  postpone,
  onHidden,
}: {
  a: Alert;
  snoozed?: boolean;
  /** Snooze is worded "postpone" (maintenance). */
  postpone?: boolean;
  /** After a snooze or dismiss took the alert off the list. */
  onHidden?: () => void;
}) {
  const { t } = useTranslation();
  const act = useAlertAction();
  const run = (action: Parameters<typeof act.mutate>[0]["action"]) =>
    act.mutate({ id: a.id, action }, { onSuccess: action === "read" ? undefined : onHidden });
  const snooze = (days: number) => (
    <Button key={days} onClick={() => run({ snooze: days })}>
      {t(postpone ? "alerts:postpone" : "alerts:snooze", { count: days })}
    </Button>
  );
  return (
    <>
      {!a.readAt && !snoozed && <Button onClick={() => run("read")}>{t("alerts:markRead")}</Button>}
      {!snoozed && [1, 7].map(snooze)}
      <Button variant="ghost" onClick={() => run("dismiss")}>
        {t("alerts:dismiss")}
      </Button>
    </>
  );
}

function Row({ a, snoozed }: { a: Alert; snoozed?: boolean }) {
  const { t } = useTranslation();
  const s = SEVERITY[a.severity];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="flex min-w-0 items-start gap-2">
        {!a.readAt && !snoozed && (
          <span
            className="mt-2 size-2 shrink-0 rounded-full bg-accent"
            title={t("alerts:unread")}
          />
        )}
        <s.icon
          className={`mt-0.5 size-4 shrink-0 ${s.color}`}
          role="img"
          aria-label={t(s.label)}
        />
        <div className="min-w-0">
          <Title a={a} inList />
          <p className="text-muted">
            {t("alerts:meta", {
              module: t(MODULE[a.module]),
              date: snoozed
                ? t("alerts:snoozedUntil", { date: formatDateTime(a.snoozedUntil ?? "") })
                : formatDateTime(a.createdAt),
            })}
          </p>
          {a.hasDetail && <Detail id={a.id} />}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {a.kind === "sync_pending" && (
          <Link
            to="/import/$source/$id/$type"
            params={{
              source: "integration",
              id: String(a.context.integrationId),
              type: String(a.context.type),
            }}
            className={buttonLink}
          >
            {t("alerts:review")}
          </Link>
        )}
        <AlertButtons a={a} snoozed={snoozed} />
      </div>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-surface px-4 py-2">
      <h2 className="pt-2 text-base font-semibold">{title}</h2>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

export function AlertsPage() {
  const { t } = useTranslation();
  const { data } = useAlerts();
  const now = Date.now();
  const snoozed = (data ?? []).filter((a) => a.snoozedUntil && Date.parse(a.snoozedUntil) > now);
  const active = (data ?? []).filter((a) => !snoozed.includes(a));
  return (
    <>
      <PageHeader
        title={t("nav:items.alerts.label")}
        description={t("nav:items.alerts.description")}
        actions={<SettingsLink module="alerts" />}
      />
      {data && !data.length && (
        <EmptyState
          icon={BellOff}
          title={t("alerts:empty.title")}
          description={t("alerts:empty.body")}
        />
      )}
      {active.length > 0 && (
        <Group title={t("alerts:active")}>
          {active.map((a) => (
            <Row key={a.id} a={a} />
          ))}
        </Group>
      )}
      {snoozed.length > 0 && (
        <Group title={t("alerts:snoozedTitle")}>
          {snoozed.map((a) => (
            <Row key={a.id} a={a} snoozed />
          ))}
        </Group>
      )}
    </>
  );
}
