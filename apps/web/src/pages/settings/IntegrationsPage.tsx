import { INTEGRATION_KINDS } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plug, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useCan } from "../../lib/auth.ts";
import { libraryOf, useAdapters, useIntegrations, useMayTask } from "../../lib/integrations.ts";
import { LibraryCard } from "./IntegrationCard.tsx";

const addClass =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const may = useMayTask();
  // An editor gets the integrations with a task of theirs, and only those tasks (ADR-0012).
  const list = useIntegrations();
  const data = admin
    ? list.data
    : list.data?.filter((i) => i.policies.some((p) => may(i.id, p.type, "any")));
  const { isError } = list;
  const adapters = useAdapters().data;
  const canAdd = admin && !!adapters?.length;
  const add = canAdd && (
    <Link to="/integrations/new" className={addClass}>
      <Plus className="size-4" aria-hidden />
      {t("integrations:add")}
    </Link>
  );
  // One card per slicer library or account (ADR-0019): accounts first, then slicers; inside, the
  // places it runs in kind order (this computer, this server, workstations), oldest first.
  const rank = (k: string) => INTEGRATION_KINDS.indexOf(k as (typeof INTEGRATION_KINDS)[number]);
  const rows = [...(data ?? [])].sort((a, b) => rank(a.kind) - rank(b.kind));
  const libraries = [...new Set(rows.map(libraryOf))];
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
            {libraries.map((lib) => (
              <LibraryCard
                key={lib}
                library={lib}
                rows={rows.filter((i) => libraryOf(i) === lib)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Plug}
            title={t("integrations:emptyTitle")}
            description={
              !admin
                ? t("integrations:noTasks")
                : canAdd
                  ? t("integrations:emptyBody")
                  : t("integrations:noAdapters")
            }
            action={add}
          />
        ))}
    </>
  );
}
