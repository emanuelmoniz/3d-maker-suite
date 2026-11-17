import type { Monitoring, PrinterState } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { cx } from "../../lib/cx.ts";
import { formatNumber } from "../../lib/format.ts";

// Literal keys so `pnpm i18n:check` sees them.
const STATES: Record<PrinterState, string> = {
  offline: "printers:status.states.offline",
  idle: "printers:status.states.idle",
  preparing: "printers:status.states.preparing",
  printing: "printers:status.states.printing",
  paused: "printers:status.states.paused",
  finished: "printers:status.states.finished",
  cancelled: "printers:status.states.cancelled",
  error: "printers:status.states.error",
};
const DOT: Record<PrinterState, string> = {
  offline: "bg-border",
  idle: "bg-muted",
  preparing: "bg-warn",
  printing: "bg-accent",
  paused: "bg-warn",
  finished: "bg-ok",
  cancelled: "bg-muted",
  error: "bg-bad",
};

/** What to do about a state that needs it (the printer page). */
export function useMonitoringHint() {
  const { t } = useTranslation();
  return (m: Monitoring) =>
    m.kind === "none"
      ? t("printers:monitoring.hints.none")
      : m.kind === "offline"
        ? t("printers:monitoring.hints.offline")
        : m.kind === "machine_offline"
          ? t("printers:monitoring.hints.machineOffline", { machine: m.machine })
          : m.kind === "error"
            ? t("printers:monitoring.hints.error")
            : null;
}

/** A printer's connection as the list and the printer page say it: a dot and a few words. */
export function MonitoringBadge({ monitoring: m }: { monitoring: Monitoring }) {
  const { t } = useTranslation();
  const [dot, text] =
    m.kind === "none"
      ? ["bg-border", t("printers:monitoring.none")]
      : m.kind === "checking"
        ? ["bg-border", t("printers:monitoring.checking")]
        : m.kind === "offline"
          ? ["bg-border", t("printers:monitoring.offline")]
          : m.kind === "machine_offline"
            ? ["bg-warn", t("printers:monitoring.machineOffline")]
            : m.kind === "error"
              ? ["bg-bad", t("printers:monitoring.error")]
              : m.progress != null
                ? [
                    DOT[m.state],
                    t("printers:monitoring.printing", {
                      percent: formatNumber(m.progress / 100, { style: "percent" }),
                    }),
                  ]
                : [DOT[m.state], t(STATES[m.state])];
  return (
    <span className={cx("inline-flex items-center gap-1.5", m.kind === "none" && "text-muted")}>
      <span className={cx("size-2 shrink-0 rounded-full", dot)} aria-hidden />
      {text}
    </span>
  );
}
