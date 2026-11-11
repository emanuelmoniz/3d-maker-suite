import {
  type Integration,
  type LibrarySources,
  SLICER_CATALOG_ROW_TYPES,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Cable } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { useCan } from "../../lib/auth.ts";
import { useAdapterName, useIntegrations } from "../../lib/integrations.ts";
import { useCatalogSources } from "../../lib/presets.ts";
import { IntegrationsLink, PolicyLines } from "./AccountSources.tsx";
import { ChooseBrands } from "./ChooseBrands.tsx";
import { LOCATION_ICONS } from "./integrationLabels.ts";
import {
  ReceiveSection,
  type ReceiveSlicer,
  receiversOf,
  useSystemLine,
} from "./ReceiveSources.tsx";
import {
  SlicerGroup,
  SourceBadge,
  SourceBlock,
  SourceIcon,
  SourcesSection,
  StateLines,
} from "./Sources.tsx";

/** Whether a library's catalog source is this pick (an install row or a machine). */
export const isSource = (
  lib: LibrarySources,
  pick: { integrationId?: string; deviceId?: string },
) =>
  !!lib.source &&
  ("integrationId" in lib.source
    ? lib.source.integrationId === pick.integrationId
    : lib.source.deviceId === pick.deviceId);

/** This server's install rows per library: the ones that can be the catalog source. */
export const serverRows = (lib: LibrarySources, list: Integration[]) =>
  lib.options.flatMap((o) =>
    "integrationId" in o
      ? (list.find((i) => i.id === o.integrationId && i.kind !== "worker") ?? [])
      : [],
  );

/** The machines of the libraries, each with the libraries `on` picks for it. */
function machinesOf(
  libraries: LibrarySources[],
  on: (lib: LibrarySources, m: LibrarySources["machines"][number]) => boolean,
) {
  const byId = new Map<string, { name: string; libraries: LibrarySources[] }>();
  for (const lib of libraries)
    for (const m of lib.machines)
      if (on(lib, m)) {
        const entry = byId.get(m.deviceId) ?? { name: m.name, libraries: [] };
        entry.libraries.push(lib);
        byId.set(m.deviceId, entry);
      }
  return [...byId].map(([id, m]) => ({ id, ...m }));
}

/**
 * Catalog settings → Sources: per library, only its hub's slicer (ADR-0022, picked in
 * Integrations), the one install that shares the catalog: this server's or one machine's, with its
 * four lines and Choose brands. Then every other install that can receive its `system/`.
 */
export function CatalogSources() {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const list = useIntegrations().data;
  const libraries = useCatalogSources().data;
  if (!list || !libraries) return null;
  const server = libraries.flatMap((lib) => {
    const s = lib.source;
    const i = s && "integrationId" in s ? list.find((x) => x.id === s.integrationId) : undefined;
    return i ? [{ lib, i }] : [];
  });
  const sharing = machinesOf(libraries, (lib, m) => isSource(lib, { deviceId: m.deviceId }));
  const receivers = receiversOf(libraries, list);
  if (!server.length && !sharing.length && !receivers.length)
    return (
      <EmptyState
        icon={Cable}
        title={t("settings:sources.empty.catalog")}
        description={t("settings:sources.empty.catalogBody")}
        action={admin && <IntegrationsLink />}
      />
    );
  return (
    <>
      <SourcesSection direction="share">
        {server.length > 0 && (
          <SourceBlock
            id="server"
            icon={<SourceIcon icon={LOCATION_ICONS.server} />}
            title={t("settings:sources.server")}
            link={
              admin
                ? { to: "/integrations", label: t("settings:sources.toIntegrations") }
                : undefined
            }
          >
            {server.map(({ lib, i }) => (
              <CatalogSlicer
                key={i.id}
                lib={lib}
                list={list}
                pick={{ integrationId: i.id }}
                id={`server-${lib.library}`}
              />
            ))}
          </SourceBlock>
        )}
        {sharing.map((m) => (
          <MachineBlock key={m.id} id={m.id} name={m.name}>
            {m.libraries.map((lib) => (
              <CatalogSlicer key={lib.library} lib={lib} list={list} pick={{ deviceId: m.id }} />
            ))}
          </MachineBlock>
        ))}
      </SourcesSection>
      <ReceiveSection
        receivers={receivers}
        slicer={(sl, r) => <ReceiveCatalog key={sl.lib.library} slicer={sl} receiver={r.name} />}
      />
    </>
  );
}

/** A machine's block, linking back to its page, where its Catalog and Presets switches are. */
export function MachineBlock({
  id,
  name,
  receive,
  children,
}: {
  id: string;
  name: string;
  /** In Receive from the hub: its own anchor. */
  receive?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <SourceBlock
      id={`${receive ? "receive" : "machine"}-${id}`}
      icon={<SourceIcon icon={LOCATION_ICONS.worker} />}
      title={name}
      link={{
        to: "/hub/devices/$deviceId",
        params: { deviceId: id },
        label: t("settings:sources.toMachine"),
      }}
    >
      {children}
    </SourceBlock>
  );
}

/** The hub's slicer in Share to the hub: its catalog's four lines and Choose brands. */
function CatalogSlicer({
  lib,
  list,
  pick,
  id,
}: {
  lib: LibrarySources;
  list: Integration[];
  pick: { integrationId: string } | { deviceId: string };
  id?: string;
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const manage = useCan("catalog", "manage");
  const meta = useHubSlicerMeta();
  const name = adapterName(lib.library);
  const cards = lib.cardsOf ? list.find((i) => i.id === lib.cardsOf) : undefined;
  const unreadable =
    "integrationId" in pick &&
    lib.options.some(
      (o) => "integrationId" in o && o.integrationId === pick.integrationId && !o.readable,
    );
  return (
    <SlicerGroup
      id={id ?? ("deviceId" in pick ? `machine-${pick.deviceId}-${lib.library}` : undefined)}
      name={name}
      badge={<SourceBadge>{t("settings:sources.catalog.source")}</SourceBadge>}
      meta={meta(lib, unreadable)}
      action={<ChangeHubSlicer library={lib.library} />}
    >
      {"deviceId" in pick && (
        <p className="max-w-prose text-muted">{t("settings:sources.catalog.fromDevice")}</p>
      )}
      {cards && manage && cards.capabilities.includes("brands") && (
        <ChooseBrands integration={cards} />
      )}
      {cards && (
        <PolicyLines
          integration={cards}
          types={[...SLICER_CATALOG_ROW_TYPES]}
          title={name}
          how={false}
        />
      )}
    </SlicerGroup>
  );
}

export const serverRowsCount = (lib: LibrarySources, list: Integration[]) =>
  serverRows(lib, list).length;

/** The hub's slicer heading's facts: its version, a folder not found, picked for you. */
export function useHubSlicerMeta() {
  const { t } = useTranslation();
  return (lib: LibrarySources, unreadable = false) =>
    [
      lib.version ? t("settings:sources.catalog.version", { version: lib.version }) : null,
      unreadable ? t("settings:sources.catalog.unreadable") : null,
      !lib.source?.picked ? t("settings:sources.catalog.picked") : null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;
}

/** "Change in Integrations" on the hub's slicer heading: it is picked there (ADR-0022). */
export function ChangeHubSlicer({ library }: { library: string }) {
  const { t } = useTranslation();
  if (!useCan("integrations.manage")) return null;
  return (
    <Link
      to="/integrations"
      hash={`library-${library}`}
      className="text-sm font-medium text-accent hover:underline"
    >
      {t("settings:sources.catalog.change")}
    </Link>
  );
}

/** A receiver's slicer on the Catalog tab: its Catalog and system presets line. */
function ReceiveCatalog({ slicer, receiver }: { slicer: ReceiveSlicer; receiver: string }) {
  const { t } = useTranslation();
  const name = useAdapterName()(slicer.lib.library);
  const { row, after } = useSystemLine(slicer);
  const id = slicer.machine?.deviceId ?? "server";
  return (
    <SlicerGroup id={`receive-${id}-${slicer.lib.library}`} name={name}>
      <StateLines
        label={t("settings:sources.presets.linesOf", {
          slicer: name,
          machine: receiver || t("settings:sources.server"),
        })}
        rows={[row]}
      />
      {after}
    </SlicerGroup>
  );
}
