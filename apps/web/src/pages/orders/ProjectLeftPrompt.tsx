import type { OrderDetail, Page, PrintDetail } from "@3d-maker-suite/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { api } from "../../lib/api.ts";
import { orderName } from "../../lib/orders.ts";
import { projectName, useProjects } from "../../lib/projects.ts";

/**
 * Before a print leaves an order: when it is the order's last print of its project (and the order
 * has other projects), asks whether to drop that project from the order too. Ask before saving:
 * the print form remounts once the print is saved.
 */
export function useProjectLeftPrompt() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const projects = useProjects().data?.items ?? [];
  const [ask, setAsk] = useState<{
    order: OrderDetail;
    projectId: string;
    answer: (drop: boolean) => void;
  }>();

  /** Resolves to whether the user wants the project dropped (false when there is nothing to ask). */
  const confirm = async (orderId: string, projectId: string | null, printId: string) => {
    if (!projectId) return false;
    const order = await api<OrderDetail>("GET", `/api/orders/${orderId}`);
    if (order.projectIds.length < 2 || !order.projectIds.includes(projectId)) return false;
    const { items } = await api<Page<PrintDetail>>(
      "GET",
      `/api/prints?${new URLSearchParams({ orderId, projectId, pageSize: "2" })}`,
    );
    if (items.some((p) => p.id !== printId)) return false;
    return new Promise<boolean>((answer) => setAsk({ order, projectId, answer }));
  };

  /** Drops the project from the order; run once the print has left it. */
  const drop = async (orderId: string, projectId: string) => {
    const order = await api<OrderDetail>("GET", `/api/orders/${orderId}`);
    await api("PATCH", `/api/orders/${orderId}`, {
      projectIds: order.projectIds.filter((id) => id !== projectId),
    });
    await qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const close = (drop: boolean) => {
    ask?.answer(drop);
    setAsk(undefined);
  };
  const project = ask && projects.find((p) => p.id === ask.projectId);
  const dialog = (
    <ConfirmDialog
      open={!!ask}
      title={t("orders:projectLeft.title")}
      description={
        ask
          ? t("orders:projectLeft.body", {
              project: project ? projectName(t, project) : "",
              order: orderName(t, ask.order),
            })
          : ""
      }
      confirmLabel={t("orders:projectLeft.remove")}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  );
  return { confirm, drop, dialog };
}
