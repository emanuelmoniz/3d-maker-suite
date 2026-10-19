import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useClient } from "../../lib/clients.ts";
import { QuotesTable } from "../costs/QuotesTable.tsx";
import { Info, linkButton } from "../filament/SpoolDetailPage.tsx";

// The orders table joins this page with the orders step.
export function ClientDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: client, isError } = useClient(id);
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
          <Link to="/clients/$id/edit" params={{ id }} className={linkButton}>
            {t("clients:detail.edit")}
          </Link>
        }
      />
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
    </>
  );
}
