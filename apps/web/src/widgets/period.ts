import { z } from "zod";
import type { StatsFilters } from "../lib/stats.ts";
import type { WidgetField } from "./registry.ts";

export const PERIODS = ["month", "week", "30"] as const;

export const periodSetting = z.enum(PERIODS).default("month");

export const PERIOD_LABELS = {
  month: "dashboard:periods.month",
  week: "dashboard:periods.week",
  "30": "dashboard:periods.30",
} as const;

export const periodField: WidgetField = {
  key: "period",
  label: "dashboard:fields.period",
  kind: "select",
  options: [
    { value: "month", label: "dashboard:periods.month" },
    { value: "week", label: "dashboard:periods.week" },
    { value: "30", label: "dashboard:periods.30" },
  ],
};

const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Same filters object the Stats page uses, so the widgets share its query and service. */
export function statsFor(period: (typeof PERIODS)[number], bucket: StatsFilters["bucket"] = "day") {
  const d = new Date();
  if (period === "month") d.setDate(1);
  else d.setDate(d.getDate() - (period === "week" ? 7 : 30));
  return {
    from: day(d),
    to: "",
    printerId: "",
    spoolId: "",
    profileId: "",
    projectId: "",
    tagId: "",
    outcome: "",
    bucket,
  };
}
