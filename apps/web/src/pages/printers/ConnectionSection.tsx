import { monitoringOf, type PrinterStatus } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Write } from "../../components/Write.tsx";
import { usePrinterConnection } from "../../lib/printers.ts";
import { MonitoringBadge, useMonitoringHint } from "./MonitoringBadge.tsx";
import { Info, linkButton } from "./PrinterDetailPage.tsx";

// Literal keys so `pnpm i18n:check` sees them.
const SECRETS: Record<string, string> = {
  accessCode: "printers:connection.secrets.accessCode",
  apiKey: "printers:connection.secrets.apiKey",
  password: "printers:connection.secrets.password",
  token: "printers:connection.secrets.token",
};

/**
 * Where a printer is read from, one block per source (ADR-0015). Display only: the setup is
 * changed in Integrations, and no secret is shown, only that one is set.
 */
export function ConnectionSection({
  printerId,
  live,
}: {
  printerId: string;
  live: readonly PrinterStatus[];
}) {
  const { t } = useTranslation();
  const hint = useMonitoringHint();
  const { data, isError } = usePrinterConnection(printerId);
  const sources = data?.sources ?? [];

  return (
    <section className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{t("printers:connection.title")}</h2>
        <p className="text-muted">{t("printers:connection.description")}</p>
      </div>
      {isError && (
        <p role="alert" className="text-bad">
          {t("printers:connection.loadError")}
        </p>
      )}
      {data && sources.length === 0 && (
        <p className="text-muted">{t("printers:connection.none")}</p>
      )}
      {sources.map((s) => {
        const reads = live.filter((l) => l.integrationId === s.integrationId);
        // A paused integration isn't read, whatever it said last.
        const monitoring = s.enabled ? monitoringOf(printerId, reads) : ({ kind: "none" } as const);
        const via = reads.find((l) => l.via)?.via;
        const note = hint(monitoring);
        return (
          <div key={s.integrationId} className="grid gap-3 rounded-md border border-border p-3">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Info label={t("printers:connection.source")}>
                {t(`integrations:adapters.${s.adapterId}.name`, { defaultValue: s.adapterId })}
                {!s.enabled && (
                  <span className="ml-2 text-muted">{t("printers:connection.paused")}</span>
                )}
              </Info>
              {s.host !== undefined && (
                <Info label={t("printers:connection.host")}>
                  <span className="wrap-anywhere">{s.host ?? "—"}</span>
                </Info>
              )}
              {s.secrets !== undefined && (
                <Info label={t("printers:connection.secret")}>
                  {s.secrets.length === 0
                    ? t("printers:connection.noSecret")
                    : s.secrets
                        .map((k) => t(SECRETS[k] ?? "printers:connection.secrets.other"))
                        .join(", ")}
                </Info>
              )}
              <Info label={t("printers:connection.reachedFrom")}>
                {s.deviceId
                  ? t(
                      via
                        ? via.online
                          ? "printers:connection.machineOnline"
                          : "printers:connection.machineOffline"
                        : "printers:connection.machineUnknown",
                      { machine: s.deviceName ?? via?.deviceName ?? "" },
                    )
                  : t("printers:connection.thisServer")}
              </Info>
              <Info label={t("printers:connection.monitoring")}>
                <MonitoringBadge monitoring={monitoring} />
              </Info>
            </dl>
            {note && <p className="text-muted">{note}</p>}
            <Write can="integrations.manage">
              <Link
                to="/integrations/$id/edit"
                params={{ id: s.integrationId }}
                className={`${linkButton} justify-self-start`}
              >
                {t("printers:connection.edit")}
              </Link>
            </Write>
          </div>
        );
      })}
    </section>
  );
}
