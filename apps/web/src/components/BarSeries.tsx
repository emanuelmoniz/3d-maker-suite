import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMoney } from "../lib/cost.ts";
import { formatDate, formatDuration, formatNumber } from "../lib/format.ts";

export type SeriesRow = { key: string; prints: number; seconds: number; total: number };
export type SeriesMetric = "prints" | "hours" | "total";

/** Round-number ticks (1, 2, 5 x 10^n) from 0 up to just past `max`: 56 gives 0, 20, 40, 60. */
export function niceTicks(max: number, count = 3) {
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks = [0];
  while ((ticks.at(-1) ?? 0) < max) ticks.push(+((ticks.at(-1) ?? 0) + step).toPrecision(12));
  return ticks;
}

const axis = { fontSize: 12, fill: "var(--muted)" };

/** Bar chart over time with value axes on both sides and a date + value tooltip (hover, tap, keyboard). */
export function BarSeries({
  series,
  metric,
  height,
}: {
  series: SeriesRow[];
  metric: SeriesMetric;
  height: number;
}) {
  const money = useMoney();
  const value = (m: SeriesRow) =>
    metric === "prints" ? m.prints : metric === "hours" ? m.seconds / 3600 : m.total / 100;
  const shown = (m: SeriesRow) =>
    metric === "prints"
      ? formatNumber(m.prints)
      : metric === "hours"
        ? formatDuration(m.seconds)
        : money(m.total);
  const tick = (v: number) =>
    metric === "total"
      ? money(v * 100)
      : metric === "hours"
        ? formatNumber(v, { style: "unit", unit: "hour", unitDisplay: "narrow" })
        : formatNumber(v);
  const ticks = niceTicks(Math.max(1, ...series.map(value)));
  const domain: [number, number] = [0, ticks.at(-1) ?? 1];
  const data = series.map((r) => ({ key: r.key, v: value(r), label: shown(r) }));
  const yAxis = { domain, ticks, tickFormatter: tick, tick: axis, tickLine: false, width: 48 };

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid yAxisId="l" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="key"
            tickFormatter={formatDate}
            tick={axis}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            interval="preserveStartEnd"
            minTickGap={56}
          />
          <YAxis yAxisId="l" {...yAxis} axisLine={false} />
          <YAxis yAxisId="r" {...yAxis} orientation="right" axisLine={false} />
          <Tooltip
            cursor={{ fill: "var(--accent-soft)" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return active && p ? (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-md">
                  <div className="text-muted">{formatDate(p.key)}</div>
                  <div className="font-semibold">{p.label}</div>
                </div>
              ) : null;
            }}
          />
          {/* Invisible series that only gives the right-hand axis something to bind to. */}
          <Line
            yAxisId="r"
            dataKey="v"
            stroke="none"
            dot={false}
            activeDot={false}
            legendType="none"
          />
          <Bar
            yAxisId="l"
            dataKey="v"
            fill="var(--accent)"
            radius={[4, 4, 0, 0]}
            minPointSize={2}
            maxBarSize={40}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
