import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useDue } from "../lib/maintenance.ts";
import { defineWidget } from "./registry.ts";
import { WidgetCard } from "./Widget.tsx";

const STATUS = {
  ok: "maintenance:due.status.ok",
  upcoming: "maintenance:due.status.upcoming",
  overdue: "maintenance:due.status.overdue",
} as const;

defineWidget({
  type: "maintenanceDue",
  title: "dashboard:widgets.maintenanceDue",
  span: 2,
  settings: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
  fields: [{ key: "limit", label: "dashboard:fields.limit", kind: "number", min: 1, max: 20 }],
  Component: function MaintenanceWidget({ settings: s }) {
    const { t } = useTranslation();
    const due = (useDue().data ?? []).filter((i) => i.status !== "ok");
    return (
      <WidgetCard
        title={t("dashboard:widgets.maintenanceDue")}
        more={
          <Link to="/maintenance" className="text-accent hover:underline">
            {t("dashboard:viewAll")}
          </Link>
        }
      >
        {due.length ? (
          <ul className="divide-y divide-border">
            {due.slice(0, s.limit).map((i) => (
              <li
                key={`${i.printerId}${i.typeId}`}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span>
                  <span className="font-medium">{i.typeName}</span>{" "}
                  <span className="text-muted">{i.printerName}</span>
                </span>
                <span className={i.status === "overdue" ? "text-bad" : "text-warn"}>
                  {t(STATUS[i.status])}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("dashboard:maintenanceNone")}</p>
        )}
      </WidgetCard>
    );
  },
});
