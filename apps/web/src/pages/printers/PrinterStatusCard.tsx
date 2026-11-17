import type { PrinterState, PrinterStatus } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cx, textLink } from "../../lib/cx.ts";
import { formatDuration, formatNumber, formatTime } from "../../lib/format.ts";

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
/** The color the printed layers take: what happened to the print. */
const LAYERS: Partial<Record<PrinterState, string>> = {
  finished: "bg-ok",
  cancelled: "bg-muted",
  error: "bg-bad",
};
/** Lines in the layer stack. */
const LINES = 12;
const RUNNING = new Set<PrinterState>(["preparing", "printing", "paused"]);

const celsius = (n: number) =>
  formatNumber(n, { style: "unit", unit: "celsius", maximumFractionDigits: 0 });

/**
 * The print growing on the bed: thin lines filled from the bottom, as far as it got. By layer when
 * the printer counts them (a share of the model), else by its percent.
 */
function LayerStack({ status }: { status: PrinterStatus["snapshot"] }) {
  const { t } = useTranslation();
  const job = status.job;
  const share =
    job?.layer != null && job.totalLayers
      ? job.layer / job.totalLayers
      : job?.progress != null
        ? job.progress / 100
        : status.state === "finished"
          ? 1
          : 0;
  const filled = Math.round(Math.min(1, share) * LINES);
  const tone = LAYERS[status.state] ?? "bg-accent";
  const printing = status.state === "printing";
  const text =
    job?.layer != null && job.totalLayers
      ? t("printers:status.layer", { layer: job.layer, total: job.totalLayers })
      : formatNumber(share, { style: "percent" });
  return (
    <div
      role="progressbar"
      aria-label={t("printers:status.progress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={text}
      className="flex h-20 w-14 shrink-0 flex-col-reverse gap-0.5 rounded-md bg-surface-2 p-1.5"
    >
      {/* The bed, then the layers printed so far on it. */}
      <span className="h-1 shrink-0 rounded-full bg-muted" />
      {Array.from({ length: filled }, (_, i) => (
        <span
          key={i}
          className={cx(
            "mx-1 h-0.75 shrink-0 rounded-full",
            tone,
            // The layer being laid down now.
            printing && i === filled - 1 && "animate-pulse motion-reduce:animate-none",
          )}
        />
      ))}
    </div>
  );
}

/** What one printer is doing now: state, how far, when it's done, temperatures and filament. */
export function PrinterStatusCard({
  status: { printerId, snapshot: s, via },
  name,
  link = false,
}: {
  status: PrinterStatus;
  name: string;
  /** Its name links to the printer's page (the dashboard). */
  link?: boolean;
}) {
  const { t } = useTranslation();
  const heading = useId();
  const job = RUNNING.has(s.state) || s.state in LAYERS ? s.job : undefined;
  const offline = s.state === "offline";
  const doneAt = job?.etaSec != null ? Date.parse(s.at) + job.etaSec * 1000 : null;
  const temps = [
    {
      label: t("printers:status.nozzle"),
      now: s.temperatures?.nozzle,
      to: s.temperatures?.nozzleTarget,
    },
    { label: t("printers:status.bed"), now: s.temperatures?.bed, to: s.temperatures?.bedTarget },
    { label: t("printers:status.chamber"), now: s.temperatures?.chamber, to: undefined },
  ].filter((x) => x.now != null && !offline);

  return (
    <article
      aria-labelledby={heading}
      className={cx(
        "grid gap-3 rounded-lg border border-border bg-surface p-4",
        offline && "text-muted",
      )}
    >
      <div className="flex gap-4">
        <LayerStack status={s} />
        <div className="grid min-w-0 flex-1 content-start gap-1">
          <div className="flex items-start justify-between gap-2">
            <h3 id={heading} className="min-w-0 font-semibold wrap-anywhere">
              {link ? (
                <Link to="/printers/$id" params={{ id: printerId }} className={textLink}>
                  {name}
                </Link>
              ) : (
                name
              )}
            </h3>
            <p aria-live="polite" className="flex shrink-0 items-center gap-1.5 font-medium">
              <span className={cx("size-2 rounded-full", DOT[s.state])} aria-hidden />
              {t(STATES[s.state])}
            </p>
          </div>
          {job?.title && <p className="truncate text-muted">{job.title}</p>}
          {job && RUNNING.has(s.state) && (
            <p>
              {job.etaSec != null && doneAt != null
                ? t("printers:status.eta", {
                    left: formatDuration(job.etaSec),
                    time: formatTime(doneAt),
                  })
                : job.progress != null && formatNumber(job.progress / 100, { style: "percent" })}
            </p>
          )}
          {s.state === "error" && job?.failureReason && (
            <p className="text-bad wrap-anywhere">{job.failureReason}</p>
          )}
          {offline && (
            <p>
              {via && !via.online
                ? t("printers:status.connectorOffline", { machine: via.deviceName })
                : t("printers:status.offlineHint")}
            </p>
          )}
          {via?.online && !offline && (
            <p className="text-muted wrap-anywhere">
              {t("printers:status.through", { machine: via.deviceName })}
            </p>
          )}
        </div>
      </div>

      {(temps.length > 0 || s.slots.length > 0) && (
        <div className="grid gap-2">
          {temps.length > 0 && (
            <dl className="flex flex-wrap gap-x-5 gap-y-1">
              {temps.map((x) => (
                <div key={x.label} className="flex gap-1.5">
                  <dt className="text-muted">{x.label}</dt>
                  <dd>
                    {x.to
                      ? t("printers:status.temperature", {
                          now: celsius(x.now ?? 0),
                          target: celsius(x.to),
                        })
                      : celsius(x.now ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {s.slots.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t("printers:status.slots")}>
              {s.slots.map((slot) => (
                <li
                  key={slot.slot}
                  className={cx(
                    "flex items-center gap-1.5 rounded-md border px-2 py-0.5",
                    slot.active ? "border-accent" : "border-border",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-3 rounded-full border border-border"
                    style={{ backgroundColor: slot.colorHex ?? "transparent" }}
                  />
                  {slot.material ?? t("printers:status.unknownMaterial")}
                  {slot.active && <span className="sr-only">{t("printers:status.feeding")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
