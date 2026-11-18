import type { SystemInfo as Info } from "@3d-maker-suite/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../lib/cx.ts";
import { formatBytes, formatList, formatNumber, formatTime } from "../lib/format.ts";

/** Lines in a meter: the same count everywhere, so the rows read as one panel. */
const LINES = 24;

/** Filled lines turn warn, then bad, as the share nears full. */
const tone = (share: number) =>
  share >= 0.95 ? "bg-bad" : share >= 0.85 ? "bg-warn" : "bg-accent";

/**
 * A share as a row of upright lines, the printer card's layer stack laid on its side: filled from
 * the left as far as it's used.
 */
function Meter({ share, label, text }: { share: number; label: string; text: string }) {
  const s = Math.min(1, Math.max(0, share));
  const filled = Math.round(s * LINES);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <meter> can't hold the drawn lines
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(s * 100)}
      aria-valuetext={text}
      className="flex h-4 gap-0.5"
    >
      {Array.from({ length: LINES }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cx("flex-1 rounded-full", i < filled ? tone(s) : "bg-surface-2")}
        />
      ))}
    </div>
  );
}

/** One measured thing: its name and figure above, the meter below, then a note if any. */
function Row({
  name,
  value,
  share,
  label,
  note,
}: {
  name: string;
  value: string;
  share: number;
  label: string;
  note?: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium wrap-anywhere">{name}</span>
        <span className="text-sm text-muted tabular-nums">{value}</span>
      </div>
      <Meter share={share} label={label} text={value} />
      {note && <p className="text-sm text-muted wrap-anywhere">{note}</p>}
    </div>
  );
}

/**
 * A machine's live CPU, memory, disks and addresses (Step 12 of 6.1.0): the machine page's System
 * section and Settings → Server's This server. `addressNote`: what to say under the addresses
 * (where the hub sees a connector from, or why none show in Docker).
 */
export function SystemInfo({ system: s, addressNote }: { system: Info; addressNote?: string }) {
  const { t } = useTranslation();
  const used = (a: number, b: number) =>
    t("common:system.used", { used: formatBytes(a), total: formatBytes(b) });
  const percent = formatNumber(s.cpuPercent / 100, { style: "percent" });
  return (
    <div className="grid gap-4">
      <Row
        name={t("common:system.cpu")}
        value={t("common:system.cpuValue", { percent, count: s.cores })}
        share={s.cpuPercent / 100}
        label={t("common:system.cpu")}
      />
      <Row
        name={t("common:system.memory")}
        value={used(s.memory.used, s.memory.total)}
        share={s.memory.total ? s.memory.used / s.memory.total : 0}
        label={t("common:system.memory")}
      />
      {s.disks.map((d) => (
        <Row
          key={d.label}
          name={d.label}
          value={used(d.total - d.free, d.total)}
          share={d.total ? (d.total - d.free) / d.total : 0}
          label={t("common:system.disk", { disk: d.label })}
          note={t("common:system.folders", { folders: formatList(d.paths) })}
        />
      ))}
      <div className="grid gap-1.5">
        <span className="font-medium">{t("common:system.addresses")}</span>
        {s.addresses.length > 0 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
            {s.addresses.map((a) => (
              <li key={a} className="select-all">
                {a}
              </li>
            ))}
          </ul>
        ) : (
          !addressNote && <p className="text-muted">{t("common:system.noAddress")}</p>
        )}
        {addressNote && <p className="text-sm text-muted wrap-anywhere">{addressNote}</p>}
      </div>
    </div>
  );
}

/** "Updated 14:32", for the section's title row. */
export function SystemUpdated({ at }: { at: string }) {
  const { t } = useTranslation();
  return (
    <span className="text-sm text-muted tabular-nums">
      {t("common:system.updated", { time: formatTime(at) })}
    </span>
  );
}
