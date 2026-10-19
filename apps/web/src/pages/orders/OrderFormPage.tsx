import type { OrderDetail } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { ApiError } from "../../lib/api.ts";
import { useClients } from "../../lib/clients.ts";
import { quoteName, useQuotes } from "../../lib/cost.ts";
import { useOrder, useOrderStatusLabel, useSaveOrder } from "../../lib/orders.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { projectName, useProjects } from "../../lib/projects.ts";
import { NewClientDialog } from "../clients/NewClientDialog.tsx";

/** Create (no `order`) or edit. */
function OrderForm({ order }: { order?: OrderDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const save = useSaveOrder(order?.id);
  const statusLabel = useOrderStatusLabel();
  const statuses = usePreferences().data?.values.orderStatuses ?? [];
  // ponytail: first 100 clients and quotes in the pickers, as QuotesTable.
  const clients = useClients({ pageSize: "100" }).data?.items ?? [];
  const quotes = useQuotes({ pageSize: "100" }).data?.items ?? [];
  const projects = useProjects().data?.items ?? [];
  const [clientId, setClientId] = useState(order?.clientId ?? "");
  const [quoteId, setQuoteId] = useState(order?.quoteId ?? "");
  const [projectIds, setProjectIds] = useState(order?.projectIds ?? []);
  const [price, setPrice] = useState(order ? String(order.price / 100) : "");
  const [newClient, setNewClient] = useState(false);
  const code = save.error instanceof ApiError ? save.error.code : undefined;

  // A quote fills what is still empty: its client, its project, its total.
  const pickQuote = (id: string) => {
    setQuoteId(id);
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    if (!clientId && q.clientId) setClientId(q.clientId);
    if (q.projectId && !projectIds.includes(q.projectId))
      setProjectIds([...projectIds, q.projectId]);
    if (!price) setPrice(String(q.quote.total / 100));
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const number = String(f.get("number") ?? "");
    save.mutate(
      {
        number: number ? Number(number) : undefined,
        clientId: clientId || null,
        quoteId: quoteId || null,
        projectIds,
        price: Math.round(Number(price) * 100),
        status: String(f.get("status")),
        notes: String(f.get("notes") ?? ""),
      },
      { onSuccess: (saved) => navigate({ to: "/orders/$id", params: { id: saved.id } }) },
    );
  };

  const statusOptions = [...new Set([...statuses, ...(order ? [order.status] : [])])].map((s) => ({
    value: s,
    label: statusLabel(s),
  }));
  return (
    <>
      <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
        <FormField
          label={t("orders:form.number")}
          hint={order ? undefined : t("orders:form.numberHint")}
          error={code === "order_number_taken" ? t("orders:form.numberTaken") : undefined}
        >
          {(p) => (
            <input
              {...p}
              name="number"
              type="number"
              min={1}
              step={1}
              className={inputClass}
              defaultValue={order?.number}
            />
          )}
        </FormField>
        <FormField label={t("orders:form.quote")}>
          {(p) => (
            <Combobox
              {...p}
              value={quoteId}
              onChange={pickQuote}
              options={[
                { value: "", label: t("orders:form.noQuote") },
                ...quotes.map((q) => ({ value: q.id, label: quoteName(t, q) })),
              ]}
            />
          )}
        </FormField>
        <FormField label={t("orders:form.client")}>
          {(p) => (
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  {...p}
                  value={clientId}
                  onChange={setClientId}
                  options={[
                    { value: "", label: t("orders:form.noClient") },
                    ...clients.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
              <Button onClick={() => setNewClient(true)}>
                <Plus className="size-4" aria-hidden />
                {t("orders:form.newClient")}
              </Button>
            </div>
          )}
        </FormField>
        <FormField
          label={t("orders:form.projects")}
          hint={t("orders:form.projectsHint")}
          error={code === "order_project_in_use" ? t("orders:form.projectInUse") : undefined}
        >
          {(p) => (
            <div className="grid gap-2">
              {projectIds.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {projectIds.map((id) => {
                    const pr = projects.find((x) => x.id === id);
                    const name = pr ? projectName(t, pr) : id;
                    return (
                      <li
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-3"
                      >
                        {name}
                        <button
                          type="button"
                          aria-label={t("orders:form.removeProject", { name })}
                          onClick={() => setProjectIds(projectIds.filter((x) => x !== id))}
                          className="rounded-full p-1 hover:bg-surface"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Combobox
                // Remount after each pick so the box is empty again.
                key={projectIds.join()}
                {...p}
                defaultValue=""
                onChange={(id) => id && setProjectIds([...projectIds, id])}
                options={[
                  { value: "", label: t("orders:form.addProject") },
                  ...projects
                    .filter((x) => !x.archivedAt && !projectIds.includes(x.id))
                    .map((x) => ({ value: x.id, label: projectName(t, x) })),
                ]}
              />
            </div>
          )}
        </FormField>
        <FormField label={t("orders:form.price")}>
          {(p) => (
            <input
              {...p}
              type="number"
              min={0}
              step={0.01}
              required
              className={inputClass}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </FormField>
        <FormField label={t("orders:form.status")}>
          {(p) => (
            <Combobox
              {...p}
              name="status"
              defaultValue={order?.status ?? statuses[0]}
              key={statusOptions.length}
              options={statusOptions}
            />
          )}
        </FormField>
        <FormField label={t("orders:form.notes")}>
          {(p) => (
            <textarea
              {...p}
              name="notes"
              className={`${inputClass} h-20 py-2`}
              defaultValue={order?.notes ?? ""}
            />
          )}
        </FormField>
        {!projectIds.length && <p className="text-muted">{t("orders:form.needsProject")}</p>}
        {save.isError && code !== "order_number_taken" && code !== "order_project_in_use" && (
          <p role="alert" className="text-bad">
            {t("orders:form.saveError")}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending || !projectIds.length}>
            {t("orders:form.save")}
          </Button>
          <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
      {/* Outside the form: the dialog holds a form of its own. */}
      <NewClientDialog
        open={newClient}
        onClose={() => setNewClient(false)}
        onSaved={(c) => setClientId(c.id)}
      />
    </>
  );
}

export function OrderCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("orders:form.addTitle")} backTo={{ to: "/orders" }} />
      <OrderForm />
    </>
  );
}

export function OrderEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, isError } = useOrder(id);
  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("orders:detail.notFound")}
      </p>
    );
  if (!data) return null;
  return (
    <>
      <PageHeader
        title={t("orders:form.editTitle")}
        backTo={{ to: "/orders/$id", params: { id } }}
      />
      <OrderForm key={data.updatedAt} order={data} />
    </>
  );
}
