import { type Order, orderFilters } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { useClients } from "../../lib/clients.ts";
import { useMoney } from "../../lib/cost.ts";
import { formatDate } from "../../lib/format.ts";
import { useUrlListQuery } from "../../lib/list.ts";
import { orderName, useDeleteOrder, useOrderStatusLabel, useOrders } from "../../lib/orders.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { projectName, useProjects } from "../../lib/projects.ts";

/**
 * Orders: all of them on the orders page, or one client's / project's (`fixed`). The name opens
 * the order's page. Its URL params are prefixed so it sits beside other tables.
 */
export function OrdersTable({
  fixed,
  title,
}: {
  fixed?: { clientId: string } | { projectId: string };
  /** Shown above the table; the section is left out while the client or project has no orders. */
  title?: string;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const statusLabel = useOrderStatusLabel();
  const statuses = usePreferences().data?.values.orderStatuses ?? [];
  const [query, setQuery] = useUrlListQuery("orders.");
  const { data } = useOrders({ ...query, ...fixed });
  // ponytail: first 100 clients for names and filter options, as QuotesTable.
  const clients = useClients({ pageSize: "100" }).data?.items ?? [];
  const projects = useProjects().data?.items ?? [];
  const del = useDeleteOrder();
  const [deleting, setDeleting] = useState<Order | null>(null);

  if (!data) return null;
  if (!data.total && !Object.keys(query).length)
    return fixed ? null : <p className="text-muted">{t("orders:list.empty")}</p>;
  const table = (
    <DataTable
      label={t("orders:list.table")}
      rows={data.items}
      rowKey={(o) => o.id}
      server={{
        query,
        onQueryChange: setQuery,
        total: data.total,
        filters: orderFilters,
        defaultSort: "-number",
      }}
      columns={[
        {
          id: "number",
          header: t("orders:list.columns.number"),
          cell: (o) => (
            <Link to="/orders/$id" params={{ id: o.id }} className="font-medium hover:underline">
              {/* The column header already says "Order". */}
              {String(o.number).padStart(3, "0")}
            </Link>
          ),
          sort: "number",
          filter: "number",
        },
        ...(fixed && "clientId" in fixed
          ? []
          : [
              {
                id: "client",
                header: t("orders:list.columns.client"),
                cell: (o: Order) => {
                  const c = clients.find((x) => x.id === o.clientId);
                  return c ? (
                    <Link to="/clients/$id" params={{ id: c.id }} className="hover:underline">
                      {c.name}
                    </Link>
                  ) : (
                    ""
                  );
                },
                sort: "client",
                filter: "clientId",
                filterOptions: clients.map((c) => ({ value: c.id, label: c.name })),
              },
            ]),
        {
          id: "projects",
          header: t("orders:list.columns.projects"),
          cell: (o) =>
            o.projectIds.map((id, i) => {
              const p = projects.find((x) => x.id === id);
              return (
                <Fragment key={id}>
                  {i > 0 && ", "}
                  {p && (
                    <Link to="/projects/$id" params={{ id }} className="hover:underline">
                      {projectName(t, p)}
                    </Link>
                  )}
                </Fragment>
              );
            }),
          filter: fixed && "projectId" in fixed ? undefined : "projectId",
          filterOptions: projects.map((p) => ({ value: p.id, label: projectName(t, p) })),
        },
        {
          id: "status",
          header: t("orders:list.columns.status"),
          cell: (o) => statusLabel(o.status),
          sort: "status",
          filter: "status",
          filterOptions: statuses.map((s) => ({ value: s, label: statusLabel(s) })),
        },
        {
          id: "price",
          header: t("orders:list.columns.price"),
          numeric: true,
          cell: (o) => money(o.price),
          sort: "price",
        },
        {
          id: "createdAt",
          header: t("orders:list.columns.createdAt"),
          cell: (o) => formatDate(o.createdAt),
          sort: "createdAt",
          filter: "createdAt",
        },
        {
          id: "actions",
          header: t("orders:list.columns.actions"),
          cell: (o) => (
            <Button
              variant="ghost"
              aria-label={t("orders:delete.named", { name: orderName(t, o) })}
              onClick={() => setDeleting(o)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          ),
        },
      ]}
    />
  );

  return (
    <>
      {title ? (
        <section aria-labelledby="orders" className="mt-6">
          <h2 id="orders" className="mb-2 text-base font-semibold">
            {title}
          </h2>
          {table}
        </section>
      ) : (
        table
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t("orders:delete.title")}
        description={deleting ? t("orders:delete.body", { name: orderName(t, deleting) }) : ""}
        confirmLabel={t("orders:delete.confirm")}
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) del.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}
