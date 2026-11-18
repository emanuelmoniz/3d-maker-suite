import { INTEGRATION_KINDS, type Integration, isSlicerKind } from "@3d-maker-suite/core";
import { Link, useLocation, useSearch } from "@tanstack/react-router";
import { Plug, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useCan } from "../../lib/auth.ts";
import {
  deviceOf,
  libraryOf,
  onIntegrationsPage,
  useAdapters,
  useIntegrations,
  useMayTask,
} from "../../lib/integrations.ts";
import { AccountsCard } from "./AccountCard.tsx";
import { LibraryCard } from "./IntegrationCard.tsx";

const addClass =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const may = useMayTask();
  // An editor gets the integrations with a task of theirs on this page, and only those tasks
  // (ADR-0012, `onIntegrationsPage`): a card only for what they see.
  const list = useIntegrations();
  const data = admin
    ? list.data
    : list.data?.filter((i) =>
        i.policies.some((p) => onIntegrationsPage(i, p.type) && may(i.id, p.type, "any")),
      );
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
  // A card only for what is set up (ADR-0022, 6.1.0 Step 9): a machine's install is added from Add
  // integration (Where) or its type's card.
  const libraries = [...new Set(rows.map(libraryOf))];
  // A link opens its cards (ADR-0022): `#<library>`, `#integration-<id>` or `?via=<deviceId>` (the
  // machine's cards); the first of them is scrolled to.
  const hash = useLocation({ select: (l) => l.hash });
  const via = (useSearch({ strict: false }) as { via?: string }).via;
  const target = hash.replace(/^library-/, "");
  const reveals = (lib: string, of: Integration[]) =>
    target === lib ||
    of.some((i) => hash === `integration-${i.id}`) ||
    (!!via && of.some((i) => (i.deviceId ?? deviceOf(i)) === via));
  const firstReveal = libraries.find((lib) =>
    reveals(
      lib,
      rows.filter((i) => libraryOf(i) === lib),
    ),
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
        (libraries.length ? (
          <div className="grid gap-6">
            {libraries.map((lib) => {
              const of = rows.filter((i) => libraryOf(i) === lib);
              // An API's accounts (ADR-0021); a slicer's places.
              const open = {
                reveal: reveals(lib, of),
                scroll:
                  lib === firstReveal
                    ? hash.startsWith("integration-")
                      ? hash
                      : (true as const)
                    : undefined,
                via,
              };
              return of.length && of.every((i) => !isSlicerKind(i.kind)) ? (
                <AccountsCard key={lib} adapterId={lib} rows={of} {...open} />
              ) : (
                <LibraryCard key={lib} library={lib} rows={of} {...open} />
              );
            })}
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
