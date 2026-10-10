import type { Alert } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { BellOff } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useAlertAction, useAlerts } from "../../lib/alerts.ts";
import { formatDate } from "../../lib/format.ts";
import { useAdapterName } from "../../lib/integrations.ts";

const link = "font-medium hover:underline";

function Title({ a }: { a: Alert }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const c = a.context;
  switch (a.kind) {
    case "spool_low":
      return (
        <Link to="/filament/spools/$id" params={{ id: a.entityId }} className={link}>
          {t("alerts:kinds.spool_low", { name: c.name, grams: c.grams })}
        </Link>
      );
    case "maintenance_due":
      return (
        <Link to="/maintenance" className={link}>
          {t(c.overdue ? "alerts:kinds.maintenance_overdue" : "alerts:kinds.maintenance_due", {
            task: c.task,
            printer: c.printer,
          })}
        </Link>
      );
    case "warranty_ending":
      return (
        <Link to="/printers/$id" params={{ id: a.entityId }} className={link}>
          {t("alerts:kinds.warranty_ending", { name: c.name, count: Number(c.days) })}
        </Link>
      );
    case "sync_failed":
      return (
        <Link to="/integrations" className={link}>
          {t("alerts:kinds.sync_failed", {
            // Alerts from before integrations lost their name still carry `name`.
            name: c.name ?? (c.adapterId ? adapterName(String(c.adapterId)) : ""),
          })}
        </Link>
      );
    case "print_failed":
      return <span className="font-medium">{t("alerts:kinds.print_failed")}</span>;
  }
}

function Row({ a, snoozed }: { a: Alert; snoozed?: boolean }) {
  const { t } = useTranslation();
  const act = useAlertAction();
  const run = (action: Parameters<typeof act.mutate>[0]["action"]) =>
    act.mutate({ id: a.id, action });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {!a.readAt && !snoozed && (
          <span className="size-2 shrink-0 rounded-full bg-accent" title={t("alerts:unread")} />
        )}
        <div className="min-w-0">
          <Title a={a} />
          <p className="text-muted">
            {snoozed
              ? t("alerts:snoozedUntil", { date: formatDate(a.snoozedUntil ?? "") })
              : formatDate(a.createdAt)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!a.readAt && !snoozed && (
          <Button onClick={() => run("read")}>{t("alerts:markRead")}</Button>
        )}
        {!snoozed && (
          <>
            <Button onClick={() => run({ snooze: 1 })}>{t("alerts:snooze", { count: 1 })}</Button>
            <Button onClick={() => run({ snooze: 7 })}>{t("alerts:snooze", { count: 7 })}</Button>
          </>
        )}
        <Button variant="ghost" onClick={() => run("dismiss")}>
          {t("alerts:dismiss")}
        </Button>
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
