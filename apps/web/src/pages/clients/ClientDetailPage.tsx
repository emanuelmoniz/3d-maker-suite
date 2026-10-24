import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Write } from "../../components/Write.tsx";
import { useClient, useDeleteClient } from "../../lib/clients.ts";
import { useOrders } from "../../lib/orders.ts";
import { Info, linkButton } from "../filament/SpoolDetailPage.tsx";
import { OrdersTable } from "../orders/OrdersTable.tsx";
import { QuotesTable } from "../quotes/QuotesTable.tsx";

export function ClientDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: client, isError } = useClient(id);
  const hasOrders = !!useOrders({ clientId: id, pageSize: "1" }).data?.total;
  const del = useDeleteClient();
  const [deleting, setDeleting] = useState(false);
  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("clients:detail.notFound")}
      </p>
    );
  if (!client) return null;
  const none = t("clients:detail.none");
  return (
    <>
      <PageHeader
        title={client.name}
        backTo={{ to: "/clients" }}
        actions={
          <Write>
            <Link to="/clients/$id/edit" params={{ id }} className={linkButton}>
              {t("clients:detail.edit")}
            </Link>
            <Button
              disabled={hasOrders}
              title={hasOrders ? t("clients:detail.inUse") : undefined}
              onClick={() => setDeleting(true)}
            >
              {t("clients:delete.confirm")}
            </Button>
          </Write>
        }
      />
      {hasOrders && <p className="mb-3 text-muted">{t("clients:detail.inUse")}</p>}
      <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-base font-semibold">{t("clients:detail.title")}</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Info label={t("clients:form.mobile")}>{client.mobile}</Info>
          <Info label={t("clients:form.vat")}>{client.vat ?? none}</Info>
          <Info label={t("clients:form.email")}>{client.email ?? none}</Info>
          <Info label={t("clients:form.address")}>
            <span className="whitespace-pre-line">{client.address ?? none}</span>
          </Info>
          <Info label={t("clients:form.notes")}>
            <span className="whitespace-pre-line">{client.notes ?? none}</span>
          </Info>
        </dl>
      </section>
      <QuotesTable fixed={{ clientId: id }} title={t("costs:saved.title")} />
      <OrdersTable fixed={{ clientId: id }} title={t("orders:list.table")} />
      <ConfirmDialog
        open={deleting}
        title={t("clients:delete.title")}
        description={t("clients:delete.body", { name: client.name })}
        confirmLabel={t("clients:delete.confirm")}
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={() => del.mutate(id, { onSuccess: () => navigate({ to: "/clients" }) })}
      />
    </>
  );
}
