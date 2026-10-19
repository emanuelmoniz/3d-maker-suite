import type { OrderDetail, Page, PrintDetail } from "@3d-maker-suite/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Plus, Unlink } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { api } from "../../lib/api.ts";
import { useClient } from "../../lib/clients.ts";
import { quoteName, useMoney, useQuote } from "../../lib/cost.ts";
import { useUrlListQuery } from "../../lib/list.ts";
import {
  orderName,
  useDeleteOrder,
  useOrder,
  useOrderStatusLabel,
  useSaveOrder,
} from "../../lib/orders.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { printName, usePrints } from "../../lib/prints.ts";
import { projectName, useProjects } from "../../lib/projects.ts";
import { Info, linkButton } from "../filament/SpoolDetailPage.tsx";
import { PrintsTable } from "../prints/PrintsPage.tsx";
import { useProjectLeftPrompt } from "./ProjectLeftPrompt.tsx";

/** Links or unlinks a print, then refreshes prints and orders. */
function useLinkPrint() {
  const qc = useQueryClient();
  return async (printId: string, orderId: string | null) => {
    await api("PATCH", `/api/prints/${printId}`, { orderId });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["prints"] }),
      qc.invalidateQueries({ queryKey: ["orders"] }),
    ]);
  };
}

/** The order's prints, with a picker for prints of its projects that have no order yet. */
function OrderPrints({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const [query, setQuery] = useUrlListQuery("prints.");
  const prints = usePrints({ ...query, orderId: order.id });
  const link = useLinkPrint();
  const prompt = useProjectLeftPrompt();
  // ponytail: the newest 100 prints of the order's projects; type a print number on its page past that.
  const candidates = useQuery({
    queryKey: ["prints", "candidates", order.projectIds],
    queryFn: () =>
      api<Page<PrintDetail>>(
        "GET",
        `/api/prints?${new URLSearchParams({ projectId: order.projectIds.join(), pageSize: "100" })}`,
      ),
  }).data?.items.filter((p) => !p.orderId);
  const [pick, setPick] = useState("");

  return (
    <section aria-labelledby="order-prints" className="mt-6">
      <h2 id="order-prints" className="mb-3 text-base font-semibold">
        {t("orders:detail.prints")}
      </h2>
      <div className="mb-3 flex max-w-xl gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            key={order.printCount}
            aria-label={t("orders:detail.pickPrint")}
            value={pick}
            onChange={setPick}
            options={[
              { value: "", label: t("orders:detail.pickPrint") },
              ...(candidates ?? []).map((p) => ({ value: p.id, label: printName(t, p) })),
            ]}
          />
        </div>
        <Button
          disabled={!pick}
          onClick={async () => {
            await link(pick, order.id);
            setPick("");
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t("orders:detail.addPrint")}
        </Button>
      </div>
      {prints.data &&
        (prints.data.total || Object.keys(query).length ? (
          <PrintsTable
            data={prints.data}
            query={query}
            onQueryChange={setQuery}
            actions={(p) => (
              <Button
                variant="ghost"
                aria-label={t("orders:detail.removePrint", { name: printName(t, p) })}
                onClick={async () => {
                  const drop = await prompt.confirm(order.id, p.projectId, p.id);
                  await link(p.id, null);
                  if (drop && p.projectId) await prompt.drop(order.id, p.projectId);
                }}
              >
                <Unlink className="size-4" aria-hidden />
              </Button>
            )}
          />
        ) : (
          <p className="text-muted">{t("orders:detail.printsNone")}</p>
        ))}
      {prompt.dialog}
    </section>
  );
}

export function OrderDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const money = useMoney();
  const statusLabel = useOrderStatusLabel();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: order, isError } = useOrder(id);
  const statuses = usePreferences().data?.values.orderStatuses ?? [];
  const client = useClient(order?.clientId ?? "").data;
  const quote = useQuote(order?.quoteId ?? undefined).data;
  const projects = useProjects().data?.items ?? [];
  const save = useSaveOrder(id);
  const del = useDeleteOrder();
  const [deleting, setDeleting] = useState(false);

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("orders:detail.notFound")}
      </p>
    );
  if (!order) return null;
  const none = t("orders:detail.none");
  const name = orderName(t, order);
  return (
    <>
      <PageHeader
        title={name}
        backTo={{ to: "/orders" }}
        actions={
          <>
            <Link to="/orders/$id/edit" params={{ id }} className={linkButton}>
              {t("orders:detail.edit")}
            </Link>
            <Button onClick={() => setDeleting(true)}>{t("orders:delete.confirm")}</Button>
          </>
        }
      />
      <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
        <div className="mb-4 max-w-xs">
          <FormField label={t("orders:form.status")}>
            {(p) => (
              <Combobox
                {...p}
                value={order.status}
                onChange={(status) => status !== order.status && save.mutate({ status })}
                options={[...new Set([...statuses, order.status])].map((s) => ({
                  value: s,
                  label: statusLabel(s),
                }))}
              />
            )}
          </FormField>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Info label={t("orders:detail.price")}>
            <span className="tabular-nums">{money(order.price)}</span>
          </Info>
          <Info label={t("orders:detail.printsCost", { count: order.printCount })}>
            <span className="tabular-nums">{money(order.printsCost)}</span>
          </Info>
          <Info label={t("orders:detail.margin")}>
            <span className={`tabular-nums ${order.price < order.printsCost ? "text-bad" : ""}`}>
              {money(order.price - order.printsCost)}
            </span>
          </Info>
          <Info label={t("orders:form.client")}>
            {client ? (
              <Link to="/clients/$id" params={{ id: client.id }} className="hover:underline">
                {client.name}
              </Link>
            ) : (
              none
            )}
          </Info>
          <Info label={t("orders:form.quote")}>
            {quote ? (
              <Link to="/quotes/$id" params={{ id: quote.id }} className="hover:underline">
                {quoteName(t, quote)}
              </Link>
            ) : (
              none
            )}
          </Info>
          <Info label={t("orders:form.projects")}>
            {order.projectIds.map((pid, i) => {
              const p = projects.find((x) => x.id === pid);
              return (
                <Fragment key={pid}>
                  {i > 0 && ", "}
                  {p && (
                    <Link to="/projects/$id" params={{ id: pid }} className="hover:underline">
                      {projectName(t, p)}
                    </Link>
                  )}
                </Fragment>
              );
            })}
          </Info>
          <div className="sm:col-span-3">
            <Info label={t("orders:form.notes")}>
              <span className="whitespace-pre-line">{order.notes ?? none}</span>
            </Info>
          </div>
        </dl>
      </section>
      <OrderPrints order={order} />
      <ConfirmDialog
        open={deleting}
        title={t("orders:delete.title")}
        description={t("orders:delete.body", { name })}
        confirmLabel={t("orders:delete.confirm")}
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={() => del.mutate(id, { onSuccess: () => navigate({ to: "/orders" }) })}
      />
    </>
  );
}
