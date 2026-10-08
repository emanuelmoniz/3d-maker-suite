import { useTranslation } from "react-i18next";
import { z } from "zod";
import { StatCard } from "../components/StatCard.tsx";
import { useMoney } from "../lib/cost.ts";
import { formatDuration, formatNumber, formatWeight } from "../lib/format.ts";
import { useStats } from "../lib/stats.ts";
import { PERIOD_LABELS, periodField, periodSetting, statsFor } from "./period.ts";
import { defineWidget } from "./registry.ts";

const METRICS = {
  prints: "stats:metrics.prints",
  successRate: "stats:metrics.successRate",
  hours: "stats:metrics.hours",
  filament: "stats:metrics.filament",
  cost: "stats:metrics.cost",
} as const;

const settings = z.object({
  metric: z.enum(Object.keys(METRICS) as [keyof typeof METRICS]).default("prints"),
  period: periodSetting,
});

defineWidget({
  type: "statCard",
  title: "dashboard:widgets.statCard",
  span: 1,
  settings,
  fields: [
    {
      key: "metric",
      label: "dashboard:fields.metric",
      kind: "select",
      options: [
        { value: "prints", label: "stats:metrics.prints" },
        { value: "successRate", label: "stats:metrics.successRate" },
        { value: "hours", label: "stats:metrics.hours" },
        { value: "filament", label: "stats:metrics.filament" },
        { value: "cost", label: "stats:metrics.cost" },
      ],
    },
    periodField,
  ],
  Component: function StatWidget({ settings: s }) {
    const { t } = useTranslation();
    const money = useMoney();
    const tot = useStats(statsFor(s.period)).data?.totals;
    const value = !tot
      ? "…"
      : {
          prints: formatNumber(tot.prints),
          successRate: tot.prints ? `${Math.round((tot.successes / tot.prints) * 100)}%` : "–",
          hours: formatDuration(tot.seconds),
          filament: formatWeight(tot.grams),
          cost: money(tot.total),
        }[s.metric];
    return (
      <StatCard label={t(METRICS[s.metric])} value={value} hint={t(PERIOD_LABELS[s.period])} />
    );
  },
});
