import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useCan } from "../lib/auth.ts";
import { textLink } from "../lib/cx.ts";
import { usePrinterStatus } from "../lib/printerStatus.ts";
import { printerName, usePrinters } from "../lib/printers.ts";
import { PrinterStatusCard } from "../pages/printers/PrinterStatusCard.tsx";
import { defineWidget } from "./registry.ts";
import { WidgetCard } from "./Widget.tsx";

defineWidget({
  type: "printerStatus",
  title: "dashboard:widgets.printerStatus",
  span: 4,
  settings: z.object({}),
  fields: [],
  Component: function PrinterStatusWidget() {
    const { t } = useTranslation();
    const admin = useCan("integrations.manage");
    const status = usePrinterStatus().data ?? [];
    const names = new Map(
      (usePrinters({ archived: false }).data?.items ?? []).map((p) => [p.id, printerName(t, p)]),
    );
    return (
      <WidgetCard title={t("dashboard:widgets.printerStatus")}>
        {status.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {status.map((s) => (
              <PrinterStatusCard
                key={s.printerId}
                status={s}
                name={names.get(s.printerId) ?? ""}
                link
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">
            {t("dashboard:printerStatusNone")}{" "}
            {admin && (
              <Link to="/integrations" className={textLink}>
                {t("dashboard:printerStatusAdd")}
              </Link>
            )}
          </p>
        )}
      </WidgetCard>
    );
  },
});
