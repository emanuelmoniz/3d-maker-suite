import { type Quote, quoteFilters } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { archiveColumn } from "../../components/ArchiveActions.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { ProjectRef } from "../../components/ProjectRef.tsx";
import { useClients } from "../../lib/clients.ts";
import { quoteName, useMoney, useQuotes } from "../../lib/cost.ts";
import { textLink } from "../../lib/cx.ts";
import { formatDate } from "../../lib/format.ts";
import { useHasArchived, useUrlListQuery } from "../../lib/list.ts";
import { projectName, useProjects } from "../../lib/projects.ts";

/**
 * Saved quotes: all of them on the quotes page, or one client's / project's (`fixed`). The name
 * opens the quote's page. Its URL params are prefixed so it sits beside other tables.
 */
export function QuotesTable({
  fixed,
  title,
}: {
  fixed?: { clientId: string } | { projectId: string };
  /** Shown above the table; the section is left out while the client or project has no quotes. */
  title?: string;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const [query, setQuery] = useUrlListQuery("quotes.");
  const { data } = useQuotes({ ...query, ...fixed });
  // ponytail: first 100 of each for names and filter options; a search filter if anyone has more.
  const clients = useClients({ pageSize: "100", archived: "all" }).data?.items ?? [];
  const projects = useProjects().data?.items ?? [];
  const hasArchived = useHasArchived(["costs", "quotes", "list"], "/api/costs/quotes", fixed);

  if (!data) return null;
  if (!data.total && !Object.keys(query).length && !hasArchived)
    return fixed ? null : <p className="text-muted">{t("costs:saved.empty")}</p>;
  const table = (
    <DataTable
      label={t("costs:saved.title")}
      rows={data.items}
      rowKey={(q) => q.id}
      server={{
        query,
        onQueryChange: setQuery,
        total: data.total,
        filters: quoteFilters,
        defaultSort: "-name",
        archivable: true,
        scope: fixed,
      }}
      columns={[
        {
          id: "name",
          header: t("costs:saved.columns.name"),
          cell: (q) => (
            <Link to="/quotes/$id" params={{ id: q.id }} className={textLink}>
              {quoteName(t, q)}
            </Link>
          ),
          sort: "name",
          filter: "name",
        },
        ...(fixed && "clientId" in fixed
          ? []
          : [
              {
                id: "client",
                header: t("costs:saved.columns.client"),
                cell: (q: Quote) => {
                  const c = clients.find((x) => x.id === q.clientId);
                  return c ? (
                    <Link to="/clients/$id" params={{ id: c.id }} className={textLink}>
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
        ...(fixed && "projectId" in fixed
          ? []
          : [
              {
                id: "project",
                header: t("costs:saved.columns.project"),
                cell: (q: Quote) => q.projectId && <ProjectRef id={q.projectId} />,
                sort: "project",
                filter: "projectId",
                filterOptions: projects.map((p) => ({ value: p.id, label: projectName(t, p) })),
              },
            ]),
        {
          id: "createdAt",
          header: t("costs:saved.columns.createdAt"),
          cell: (q) => formatDate(q.createdAt),
          sort: "createdAt",
          filter: "createdAt",
        },
        {
          id: "quantity",
          header: t("costs:saved.columns.quantity"),
          numeric: true,
          cell: (q) => q.quote.quantity,
          sort: "quantity",
        },
        {
          id: "total",
          header: t("costs:saved.columns.total"),
          numeric: true,
          cell: (q) => money(q.quote.total),
          sort: "total",
        },
        archiveColumn<Quote>(t, {
          kind: "quotes",
          can: "costs",
          name: (q) => quoteName(t, q),
        }),
      ]}
    />
  );

  return title ? (
    <section aria-labelledby="quotes" className="mt-6">
      <h2 id="quotes" className="mb-2 text-base font-semibold">
        {title}
      </h2>
      {table}
    </section>
  ) : (
    table
  );
}
