import type { Alert, Capability } from "@3d-maker-suite/core";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Write } from "../../components/Write.tsx";
import { useAlertAction, useAlertDetail, useEvaluateAlerts } from "../../lib/alerts.ts";
import { useCan } from "../../lib/auth.ts";
import { formatDateTime, formatWeight } from "../../lib/format.ts";
import { useDue } from "../../lib/maintenance.ts";
import { LogDialog } from "../maintenance/MaintenancePage.tsx";
import { CAPS } from "../settings/integrationLabels.ts";
import {
  AlertButtons,
  buttonLink,
  integrationHash,
  LogList,
  MODULE,
  SEVERITY,
  SyncTargetLink,
  Title,
} from "./AlertsPage.tsx";

/** What the alert is about, in words: the maintenance type, the sync type, the spool or printer. */
function taskOf(a: Alert, t: TFunction) {
  const c = a.context;
  if (a.kind === "maintenance_due") return String(c.task);
  if (a.kind.startsWith("sync_")) return t(CAPS[c.type as Capability] ?? "");
  if (a.kind === "update_available") return String(c.version);
  return String(c.name);
}

function status(a: Alert, t: TFunction) {
  if (a.resolvedAt) return t("alerts:view.resolved", { date: formatDateTime(a.resolvedAt) });
  if (a.dismissedAt) return t("alerts:view.dismissed");
  if (a.snoozedUntil && Date.parse(a.snoozedUntil) > Date.now())
    return t("alerts:snoozedUntil", { date: formatDateTime(a.snoozedUntil) });
  return t(a.readAt ? "alerts:view.read" : "alerts:unread");
}

export function AlertDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ from: "/alerts/$id" });
  const navigate = useNavigate();
  const { data: a, isError } = useAlertDetail(id, true);
  const due = useDue();
  const evaluate = useEvaluateAlerts();
  const [logging, setLogging] = useState(false);
  // Opening an alert reads it, once: marking it unread afterwards must stick.
  const act = useAlertAction();
  const opened = useRef<string>(undefined);
  const canWrite = useCan("write");
  useEffect(() => {
    if (!a || !canWrite || opened.current === a.id) return;
    opened.current = a.id;
    if (!a.readAt && !a.resolvedAt && !a.dismissedAt) act.mutate({ id: a.id, action: "read" });
  }, [a, canWrite, act.mutate]);
  const header = <PageHeader title={t("alerts:view.title")} backTo={{ to: "/alerts" }} />;
  if (isError) {
    return (
      <>
        {header}
        <p role="alert" className="text-bad">
          {t("alerts:view.notFound")}
        </p>
      </>
    );
  }
  if (!a) return header;

  const s = SEVERITY[a.severity];
  const item =
    a.kind === "maintenance_due"
      ? due.data?.find((i) => `${i.targetId}:${i.typeId}` === a.entityId)
      : undefined;
  const open = !a.resolvedAt && !a.dismissedAt;
  const rows: [string, string][] = [
    [t("alerts:view.severity"), t(s.label)],
    [t("alerts:view.module"), t(MODULE[a.module])],
    [t("alerts:view.task"), taskOf(a, t)],
    ...(a.kind === "sync_success"
      ? ([
          [
            t("alerts:view.result"),
            t("alerts:view.syncResult", {
              count: Number(a.context.created),
              updated: a.context.updated,
            }),
          ],
        ] as [string, string][])
      : []),
    [t("alerts:view.raised"), formatDateTime(a.createdAt)],
    [t("alerts:view.status"), status(a, t)],
  ];
  return (
    <>
      {header}
      <section className="grid max-w-2xl gap-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start gap-2">
          <s.icon className={`mt-0.5 size-4 shrink-0 ${s.color}`} aria-hidden />
          <Title a={a} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {a.kind === "spool_low" && (
          <p>
            {t("alerts:view.spoolDetail", {
              name: a.context.name,
              grams: formatWeight(Number(a.context.grams)),
            })}
          </p>
        )}
        {a.detail && (
          <div>
            <h2 className="font-semibold">{t("alerts:details")}</h2>
            <LogList log={a.detail.log} />
          </div>
        )}
        {open && (
          <div className="flex flex-wrap gap-2">
            {a.kind === "spool_low" && (
              <Link to="/filament/spools/$id" params={{ id: a.entityId }} className={buttonLink}>
                {t("alerts:view.viewSpool")}
              </Link>
            )}
            {(a.kind === "spool_no_price" || a.kind === "spool_no_open_date") && (
              <Link
                to="/filament/spools/$id/edit"
                params={{ id: a.entityId }}
                className={buttonLink}
              >
                {t("alerts:view.editSpool")}
              </Link>
            )}
            {a.kind === "maintenance_due" && (
              <Link
                to="/maintenance/types/$id"
                params={{ id: a.entityId.split(":")[1] ?? "" }}
                className={buttonLink}
              >
                {t("alerts:view.viewTask")}
              </Link>
            )}
            {item && (
              <Write>
                <Button onClick={() => setLogging(true)}>{t("alerts:view.markDone")}</Button>
              </Write>
            )}
            {a.kind === "sync_pending" && (
              <Link
                to="/import/$source/$id/$type"
                params={{
                  source: "integration",
                  id: String(a.context.integrationId),
                  type: String(a.context.type),
                }}
                // The rows the sync left for you, not everything the source has.
                search={{ waiting: "1" } as never}
                className={buttonLink}
              >
                {t("alerts:review")}
              </Link>
            )}
            <SyncTargetLink a={a} />
            {(a.kind === "sync_error" || a.kind === "sync_success") && (
              <Link to="/integrations" hash={integrationHash(a)} className={buttonLink}>
                {t("alerts:view.openIntegration")}
              </Link>
            )}
            {a.kind === "update_available" && (
              <Link to="/settings" hash="updates" className={buttonLink}>
                {t("alerts:view.openUpdates")}
              </Link>
            )}
            {a.kind.startsWith("slice_") && (
              <Link
                to="/projects/$id/edit"
                params={{ id: String(a.context.projectId) }}
                hash="slicing"
                className={buttonLink}
              >
                {t("alerts:view.openPrintSetup")}
              </Link>
            )}
            <AlertButtons
              a={a}
              postpone={a.kind === "maintenance_due"}
              snoozed={!!a.snoozedUntil && Date.parse(a.snoozedUntil) > Date.now()}
              onHidden={() => navigate({ to: "/alerts" })}
            />
          </div>
        )}
        {a.dismissedAt && !a.resolvedAt && (
          <Write>
            <div>
              <Button onClick={() => act.mutate({ id: a.id, action: "undismiss" })}>
                {t("alerts:view.undismiss")}
              </Button>
            </div>
          </Write>
        )}
      </section>
      <LogDialog
        item={logging ? (item ?? null) : null}
        onClose={() => {
          setLogging(false);
          // Done clears the condition; the check resolves the alert right away.
          evaluate.mutate();
        }}
      />
    </>
  );
}
