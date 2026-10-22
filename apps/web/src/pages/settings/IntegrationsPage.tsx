import { INTEGRATION_KINDS } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plug, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useAdapters, useIntegrations } from "../../lib/integrations.ts";
import { IntegrationCard } from "./IntegrationCard.tsx";
import { KINDS } from "./integrationLabels.ts";

const addClass =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const { data, isError } = useIntegrations();
  const canAdd = !!useAdapters().data?.length;
  const add = canAdd && (
    <Link to="/integrations/new" className={addClass}>
      <Plus className="size-4" aria-hidden />
      {t("integrations:add")}
    </Link>
  );
  return (
    <>
      <PageHeader
        title={t("integrations:title")}
        description={t("integrations:description")}
        backTo={{ to: "/settings" }}
        actions={add}
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("integrations:loadError")}
        </p>
      )}
      {data &&
        (data.length ? (
          <div className="grid gap-6">
            {INTEGRATION_KINDS.map((kind) => {
              const rows = data.filter((i) => i.kind === kind);
              return (
                rows.length > 0 && (
                  <section key={kind} aria-labelledby={`kind-${kind}`}>
                    <h2 id={`kind-${kind}`} className="mb-3 font-semibold text-muted">
                      {t(KINDS[kind])}
                    </h2>
                    <ul className="grid gap-4">
                      {rows.map((i) => (
                        <IntegrationCard key={i.id} integration={i} />
                      ))}
                    </ul>
                  </section>
                )
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Plug}
            title={t("integrations:emptyTitle")}
            description={canAdd ? t("integrations:emptyBody") : t("integrations:noAdapters")}
            action={add}
          />
        ))}
    </>
  );
}
