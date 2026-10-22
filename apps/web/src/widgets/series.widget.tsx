import { useTranslation } from "react-i18next";
import { z } from "zod";
import { BarSeries } from "../components/BarSeries.tsx";
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
    const series = useStats(statsFor(s.period)).data?.series ?? [];
    return (
      <WidgetCard title={t(METRICS[s.metric])}>
        {series.length ? (
          <BarSeries series={series} metric={s.metric} height={160} />
        ) : (
          <p className="text-muted">{t("dashboard:empty")}</p>
        )}
      </WidgetCard>
    );
  },
});
