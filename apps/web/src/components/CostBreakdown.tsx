import type { CostBreakdown as Cost, QuoteBreakdown } from "@3d-maker-suite/core";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type SlicedEstimate, useMoney } from "../lib/cost.ts";
import { spoolName, useProfiles } from "../lib/filament.ts";
import { formatWeight } from "../lib/format.ts";
import { printerName } from "../lib/printers.ts";

type Row = { label: string; value: number; strong?: boolean; rule?: boolean };

/** Label / value rows; `strong` rows are bold, with a rule above unless `rule` is false. */
function Rows({ rows, format }: { rows: Row[]; format?: (value: number) => string }) {
  const money = useMoney();
  const show = format ?? money;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
      {rows.map((r) => (
        <div
          key={r.label}
          className={`col-span-2 grid grid-cols-subgrid ${r.strong ? "font-semibold" : ""} ${r.strong && r.rule !== false ? "border-t border-border pt-1" : ""}`}
        >
          <dt className={r.strong ? undefined : "text-muted"}>{r.label}</dt>
          <dd className="text-right tabular-nums">{show(r.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Material usage": grams per spool, then the total per material. Nothing when there is none. */
export function MaterialUsage({
  estimate,
}: {
  estimate: Pick<SlicedEstimate, "spools" | "materials">;
}) {
  const { t } = useTranslation();
  const profiles = useProfiles().data?.items ?? [];
  const { spools, materials } = estimate;
  if (!spools.length && !materials.length) return null;
  return (
    <section className="grid gap-2">
      <h4 className="font-medium">{t("costs:usage.title")}</h4>
      <Rows
        format={formatWeight}
        rows={[
          ...spools.map((s) => ({
            label: spoolName(
              t,
              s.spool,
              profiles.find((p) => p.id === s.spool.profileId),
            ),
            value: s.grams,
          })),
          ...materials.map((m, i) => ({
            label: t("costs:project.materialTotal", { material: m.material }),
            value: m.grams,
            strong: true,
            // One rule under the spools; none without spools or between materials.
            rule: i === 0 && spools.length > 0,
          })),
        ]}
      />
    </section>
  );
}

/** Which printer(s) the estimate was made on; `used` holds one id per sliced plate. */
export function PrinterHint({
  printers,
  used,
}: {
  printers: { id: string; number: number; name: string }[];
  used: (string | undefined)[];
}) {
  const { t } = useTranslation();
  const ids = new Set(used.filter((id): id is string => Boolean(id)));
  const printer = ids.size === 1 ? printers.find((p) => ids.has(p.id)) : undefined;
  return (
    <p className="text-muted">
      {printer
        ? t("costs:project.onePrintHint", { printer: printerName(t, printer) })
        : ids.size > 1
          ? t("costs:project.onePrintHintPrinters")
          : t("costs:project.onePrintHintNoPrinter")}
    </p>
  );
}

/** "Aggregated cost": the cost lines of one print, with how the material is priced. */
export function ProductionCost({ cost }: { cost: Cost }) {
  const { t } = useTranslation();
  return (
    <section className="grid gap-2">
      <h4 className="font-medium">{t("costs:aggregated.title")}</h4>
      <p className="text-muted">{t("costs:aggregated.hint")}</p>
      <CostBreakdown cost={cost} />
    </section>
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
