import { type Order, orderFilters } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { archiveColumn } from "../../components/ArchiveActions.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { ProjectRef } from "../../components/ProjectRef.tsx";
import { useClients } from "../../lib/clients.ts";
import { useMoney } from "../../lib/cost.ts";
import { formatDate } from "../../lib/format.ts";
import { useHasArchived, useUrlListQuery } from "../../lib/list.ts";
import { orderName, useOrderStatusLabel, useOrders } from "../../lib/orders.ts";
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
  const clients = useClients({ pageSize: "100", archived: "all" }).data?.items ?? [];
  const projects = useProjects().data?.items ?? [];
  const hasArchived = useHasArchived(["orders", "list"], "/api/orders", fixed);

  if (!data) return null;
  if (!data.total && !Object.keys(query).length && !hasArchived)
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
        archivable: true,
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
            o.projectIds.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && ", "}
                <ProjectRef id={id} />
              </Fragment>
            )),
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
        archiveColumn<Order>(t, {
          kind: "orders",
          can: "costs",
          name: (o) => orderName(t, o),
        }),
      ]}
    />
  );

  return title ? (
    <section aria-labelledby="orders" className="mt-6">
      <h2 id="orders" className="mb-2 text-base font-semibold">
        {title}
      </h2>
      {table}
    </section>
  ) : (
    table
  );
}
