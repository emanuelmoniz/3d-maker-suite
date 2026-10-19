import type { Order, OrderDetail, OrderInput, OrderPatch } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ListQuery } from "../components/DataTable.tsx";
import { api } from "./api.ts";
import { useListPage } from "./list.ts";

export const useOrders = (query: ListQuery) =>
  useListPage<Order>(["orders", "list"], "/api/orders", query);

export const useOrder = (id: string) =>
  useQuery({
    queryKey: ["orders", id],
    queryFn: () => api<OrderDetail>("GET", `/api/orders/${id}`),
  });

function useOrderMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Prints too: a deleted order unlinks its prints.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["orders"] }),
        qc.invalidateQueries({ queryKey: ["prints"] }),
      ]),
  });
}

/** Create (no `id`) or patch. */
export const useSaveOrder = (id?: string) =>
  useOrderMutation((v: OrderInput | OrderPatch) =>
    id
      ? api<OrderDetail>("PATCH", `/api/orders/${id}`, v)
      : api<OrderDetail>("POST", "/api/orders", v),
  );

export const useDeleteOrder = () =>
  useOrderMutation((id: string) => api("DELETE", `/api/orders/${id}`));

/** The name an order goes by everywhere: "Order 007". */
export const orderName = (t: TFunction, o: Pick<Order, "number">) =>
  t("common:orderName", { number: String(o.number).padStart(3, "0") });

const STATUSES = {
  accepted: "orders:statuses.accepted",
  in_progress: "orders:statuses.in_progress",
  done: "orders:statuses.done",
  canceled: "orders:statuses.canceled",
} as const;

/** Translated name for the built-in statuses; custom ones show as typed. */
export function useOrderStatusLabel() {
  const { t } = useTranslation();
  return (s: string) => (s in STATUSES ? t(STATUSES[s as keyof typeof STATUSES]) : s);
}
