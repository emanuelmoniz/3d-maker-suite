import { type Quote, quoteFilters } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { useClients } from "../../lib/clients.ts";
import { quoteName, useDeleteQuote, useMoney, useQuotes } from "../../lib/cost.ts";
import { formatDate } from "../../lib/format.ts";
import { useUrlListQuery } from "../../lib/list.ts";
import { projectName, useProjects } from "../../lib/projects.ts";

/**
 * Saved quotes: all of them on the costs page, or one client's / project's (`fixed`). The name
 * opens the quote in the calculator. Its URL params are prefixed so it sits beside other tables.
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
  const clients = useClients({ pageSize: "100" }).data?.items ?? [];
  const projects = useProjects().data?.items ?? [];
  const del = useDeleteQuote();
  const [deleting, setDeleting] = useState<Quote | null>(null);

  if (!data) return null;
  if (!data.total && !Object.keys(query).length)
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
      }}
      columns={[
        {
          id: "name",
          header: t("costs:saved.columns.name"),
          cell: (q) => (
            <Link
              to="/costs"
              // keeps the table's own params when it's the costs page's
              search={((s: object) => ({ ...s, quote: q.id })) as never}
              className="font-medium hover:underline"
            >
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
        ...(fixed && "projectId" in fixed
          ? []
          : [
              {
                id: "project",
                header: t("costs:saved.columns.project"),
                cell: (q: Quote) => {
                  const p = projects.find((x) => x.id === q.projectId);
                  return p ? (
                    <Link to="/projects/$id" params={{ id: p.id }} className="hover:underline">
                      {projectName(t, p)}
                    </Link>
                  ) : (
                    ""
                  );
                },
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
        {
          id: "actions",
          header: t("costs:saved.columns.actions"),
          cell: (q) => (
            <Button
              variant="ghost"
              aria-label={t("costs:saved.deleteNamed", { name: quoteName(t, q) })}
              onClick={() => setDeleting(q)}
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
        <section aria-labelledby="quotes" className="mt-6">
          <h2 id="quotes" className="mb-2 text-base font-semibold">
            {title}
          </h2>
          {table}
        </section>
      ) : (
        table
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t("costs:saved.deleteTitle")}
        description={deleting ? t("costs:saved.deleteBody", { name: quoteName(t, deleting) }) : ""}
        confirmLabel={t("costs:saved.delete")}
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
