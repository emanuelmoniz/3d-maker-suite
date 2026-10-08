import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { formatDate } from "../lib/format.ts";
import { usePrints } from "../lib/prints.ts";
import { defineWidget } from "./registry.ts";
import { WidgetCard } from "./Widget.tsx";

const OUTCOMES = {
  success: "prints:outcomes.success",
  failed: "prints:outcomes.failed",
  cancelled: "prints:outcomes.cancelled",
} as const;
const TONE = { success: "text-ok", failed: "text-bad", cancelled: "text-muted" };

defineWidget({
  type: "recentPrints",
  title: "dashboard:widgets.recentPrints",
  span: 2,
  settings: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
  fields: [{ key: "limit", label: "dashboard:fields.limit", kind: "number", min: 1, max: 20 }],
  Component: function RecentPrintsWidget({ settings: s }) {
    const { t } = useTranslation();
    const prints = usePrints().data?.items ?? [];
    return (
      <WidgetCard
        title={t("dashboard:widgets.recentPrints")}
        more={
          <Link to="/prints" className="text-accent hover:underline">
            {t("dashboard:viewAll")}
          </Link>
        }
      >
        {prints.length ? (
          <ul className="divide-y divide-border">
            {prints.slice(0, s.limit).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{p.title}</span>{" "}
                  <span className="text-muted">{formatDate(p.startedAt)}</span>
                </span>
                <span className={TONE[p.outcome]}>{t(OUTCOMES[p.outcome])}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("dashboard:printsNone")}</p>
        )}
      </WidgetCard>
    );
  },
});
