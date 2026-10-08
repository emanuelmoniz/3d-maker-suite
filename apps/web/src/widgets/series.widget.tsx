import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useMoney } from "../lib/cost.ts";
import { formatDate, formatDuration, formatNumber } from "../lib/format.ts";
import { useStats } from "../lib/stats.ts";
import { periodField, periodSetting, statsFor } from "./period.ts";
import { defineWidget } from "./registry.ts";
import { WidgetCard } from "./Widget.tsx";

const METRICS = {
  prints: "stats:series.metrics.prints",
  hours: "stats:series.metrics.hours",
  total: "stats:series.metrics.total",
} as const;

const settings = z.object({
  metric: z.enum(["prints", "hours", "total"]).default("prints"),
  period: periodSetting,
});

defineWidget({
  type: "seriesChart",
  title: "dashboard:widgets.seriesChart",
  span: 4,
  settings,
  fields: [
    {
      key: "metric",
      label: "dashboard:fields.metric",
      kind: "select",
      options: [
        { value: "prints", label: "stats:series.metrics.prints" },
        { value: "hours", label: "stats:series.metrics.hours" },
        { value: "total", label: "stats:series.metrics.total" },
      ],
    },
    periodField,
  ],
  Component: function SeriesWidget({ settings: s }) {
    const { t } = useTranslation();
    const money = useMoney();
    const series = useStats(statsFor(s.period)).data?.series ?? [];
    const value = (m: (typeof series)[number]) =>
      s.metric === "prints" ? m.prints : s.metric === "hours" ? m.seconds / 3600 : m.total / 100;
    const shown = (m: (typeof series)[number]) =>
      s.metric === "prints"
        ? formatNumber(m.prints)
        : s.metric === "hours"
          ? formatDuration(m.seconds)
          : money(m.total);
    const max = Math.max(1, ...series.map(value));
    return (
      <WidgetCard title={t(METRICS[s.metric])}>
        {series.length ? (
          <ul className="flex h-32 items-end gap-px overflow-x-auto">
            {series.map((r) => (
              <li
                key={r.key}
                title={`${formatDate(r.key)}: ${shown(r)}`}
                aria-label={`${formatDate(r.key)}: ${shown(r)}`}
                className="min-w-1 flex-1 rounded-t bg-accent"
                style={{ height: `${Math.max(2, (value(r) / max) * 100)}%` }}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("dashboard:empty")}</p>
        )}
      </WidgetCard>
    );
  },
});
