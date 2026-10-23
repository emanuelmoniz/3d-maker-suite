import { type Client, clientFilters } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useClients, useDeleteClient } from "../../lib/clients.ts";
import { useUrlListQuery } from "../../lib/list.ts";

export function ClientsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useUrlListQuery();
  const { data, isError } = useClients(query);
  const del = useDeleteClient();
  const [deleting, setDeleting] = useState<Client | null>(null);
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
      {del.isError && (
        <p role="alert" className="text-bad">
          {t("clients:detail.inUse")}
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
              {
                id: "actions",
                header: t("clients:list.columns.actions"),
                cell: (c) => (
                  <Button
                    variant="ghost"
                    aria-label={t("clients:delete.named", { name: c.name })}
                    onClick={() => {
                      del.reset();
                      setDeleting(c);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ),
              },
            ]}
          />
        )
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t("clients:delete.title")}
        description={deleting ? t("clients:delete.body", { name: deleting.name }) : ""}
        confirmLabel={t("clients:delete.confirm")}
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
