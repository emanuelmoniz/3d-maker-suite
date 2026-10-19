import { type Client, clientFilters } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useClients } from "../../lib/clients.ts";
import { useUrlListQuery } from "../../lib/list.ts";

export function ClientsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = useClients(query);
  const add = (
    <Link
      to="/clients/new"
      className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90"
    >
      <Plus className="size-4" aria-hidden />
      {t("clients:list.add")}
    </Link>
  );
  // Written out per column so `pnpm i18n:check` sees the header keys.
  const text = (id: "mobile" | "vat" | "email", header: string) => ({
    id,
    header,
    cell: (c: Client) => c[id] ?? "",
    sort: id,
    filter: id,
  });

  return (
    <>
      <PageHeader
        title={t("nav:items.clients.label")}
        description={t("nav:items.clients.description")}
        actions={add}
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("clients:loadError")}
        </p>
      )}
      {data && !data.total && !Object.keys(query).length ? (
        <EmptyState
          icon={Users}
          title={t("clients:list.emptyTitle")}
          description={t("clients:list.emptyBody")}
          action={add}
        />
      ) : (
        data && (
          <DataTable
            label={t("clients:list.table")}
            rows={data.items}
            rowKey={(c) => c.id}
            server={{ query, onQueryChange: setQuery, total: data.total, filters: clientFilters }}
            columns={[
              {
                id: "name",
                header: t("clients:list.columns.name"),
                cell: (c) => (
                  <Link
                    to="/clients/$id"
                    params={{ id: c.id }}
                    className="font-medium hover:underline"
                  >
                    {c.name}
                  </Link>
                ),
                sort: "name",
                filter: "name",
              },
              text("mobile", t("clients:list.columns.mobile")),
              text("vat", t("clients:list.columns.vat")),
              text("email", t("clients:list.columns.email")),
            ]}
          />
        )
      )}
    </>
  );
}
