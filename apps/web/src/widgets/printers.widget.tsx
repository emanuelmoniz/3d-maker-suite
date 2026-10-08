import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { usePrinters } from "../lib/printers.ts";
import { StateBadge } from "../pages/printers/StateBadge.tsx";
import { defineWidget } from "./registry.ts";
import { WidgetCard } from "./Widget.tsx";

defineWidget({
  type: "printerStates",
  title: "dashboard:widgets.printerStates",
  span: 2,
  settings: z.object({}),
  fields: [],
  Component: function PrinterStatesWidget() {
    const { t } = useTranslation();
    const printers = usePrinters({ archived: false }).data?.items ?? [];
    return (
      <WidgetCard
        title={t("dashboard:widgets.printerStates")}
        more={
          <Link to="/printers" className="text-accent hover:underline">
            {t("dashboard:viewAll")}
          </Link>
        }
      >
        {printers.length ? (
          <ul className="divide-y divide-border">
            {printers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <Link
                  to="/printers/$id"
                  params={{ id: p.id }}
                  className="font-medium hover:underline"
                >
                  {p.name}
                </Link>
                <StateBadge state={p.state} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("dashboard:printersNone")}</p>
        )}
      </WidgetCard>
    );
  },
});
