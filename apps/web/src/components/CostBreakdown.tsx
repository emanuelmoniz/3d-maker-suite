import type { CostBreakdown as Cost, QuoteBreakdown } from "@3d-maker-suite/core";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMoney } from "../lib/cost.ts";
import { formatWeight } from "../lib/format.ts";

function Rows({ rows }: { rows: { label: string; value: number; strong?: boolean }[] }) {
  const money = useMoney();
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
      {rows.map((r) => (
        <div
          key={r.label}
          className={`col-span-2 grid grid-cols-subgrid ${r.strong ? "border-t border-border pt-1 font-semibold" : ""}`}
        >
          <dt className={r.strong ? undefined : "text-muted"}>{r.label}</dt>
          <dd className="text-right tabular-nums">{money(r.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Material, energy and (when on) wear and maintenance, then the total. */
export function CostBreakdown({ cost }: { cost: Cost }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2">
      <Rows
        rows={[
          { label: t("costs:lines.material"), value: cost.material },
          { label: t("costs:lines.energy"), value: cost.energy },
          ...(cost.wear ? [{ label: t("costs:lines.wear"), value: cost.wear }] : []),
          ...(cost.maintenance
            ? [{ label: t("costs:lines.maintenance"), value: cost.maintenance }]
            : []),
          { label: t("costs:lines.total"), value: cost.total, strong: true },
        ]}
      />
      {cost.unpricedGrams > 0 && (
        <p className="flex items-start gap-1.5 text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("costs:unpriced", { weight: formatWeight(cost.unpricedGrams) })}
        </p>
      )}
    </div>
  );
}

export function QuoteBreakdownView({ quote }: { quote: QuoteBreakdown }) {
  const { t } = useTranslation();
  return (
    <Rows
      rows={[
        { label: t("costs:quote.unitCost"), value: quote.unitCost },
        { label: t("costs:quote.labor"), value: quote.labor },
        { label: t("costs:quote.failureMargin"), value: quote.failureMargin },
        { label: t("costs:quote.markup"), value: quote.markup },
        { label: t("costs:quote.unitPrice"), value: quote.unitPrice, strong: quote.quantity === 1 },
        ...(quote.quantity > 1
          ? [
              {
                label: t("costs:quote.total", { count: quote.quantity }),
                value: quote.total,
                strong: true,
              },
            ]
          : []),
      ]}
    />
  );
}
