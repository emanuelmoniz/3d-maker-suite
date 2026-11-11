import {
  type Integration,
  type LibrarySources,
  SLICER_CATALOG_ROW_TYPES,
} from "@3d-maker-suite/core";
import { Cable } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan } from "../../lib/auth.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useAdapterName, useIntegrations, useLocationLabel } from "../../lib/integrations.ts";
import { useCatalogSources, usePickCatalogSource } from "../../lib/presets.ts";
import { IntegrationsLink, PolicyLines } from "./AccountSources.tsx";
import { ChooseBrands } from "./ChooseBrands.tsx";
import { SlicerGroup, SourceBadge, SourceBlock, SourcesSection, StateLines } from "./Sources.tsx";

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

/** The machines of the libraries, each with the libraries it has a switch for. */
export function machinesOf(libraries: LibrarySources[], on: "share" | "receive") {
  const byId = new Map<string, { name: string; libraries: LibrarySources[] }>();
  for (const lib of libraries)
    for (const m of lib.machines)
      if (m[on]) {
        const entry = byId.get(m.deviceId) ?? { name: m.name, libraries: [] };
        entry.libraries.push(lib);
        byId.set(m.deviceId, entry);
      }
  return [...byId].map(([id, m]) => ({ id, ...m }));
}

/**
 * Catalog settings → Sources (ADR-0021 wireframe 4): per library, the server's slicer and each
 * machine with Catalog Share. Only the catalog source reads the catalog: its four lines and Choose
 * brands; the others offer Use as catalog source. Then the machines that receive its `system/`.
 */
export function CatalogSources() {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const list = useIntegrations().data;
  const libraries = useCatalogSources().data;
  if (!list || !libraries) return null;
  const server = libraries.filter((l) => serverRows(l, list).length);
  const sharing = machinesOf(libraries, "share");
  const receiving = machinesOf(libraries, "receive");
  if (!server.length && !sharing.length && !receiving.length)
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
            title={t("settings:sources.server")}
            link={
              admin
                ? { to: "/integrations", label: t("settings:sources.toIntegrations") }
                : undefined
            }
          >
            {server.flatMap((lib) =>
              serverRows(lib, list).map((i) => (
                <CatalogSlicer
                  key={i.id}
                  lib={lib}
                  list={list}
                  pick={{ integrationId: i.id }}
                  id={`server-${lib.library}`}
                  location={i}
                />
              )),
            )}
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
      {receiving.length > 0 && (
        <SourcesSection direction="receive">
          {receiving.map((m) => (
            <MachineBlock key={m.id} id={m.id} name={m.name} receive>
              {m.libraries.map((lib) => (
                <ReceiveSystem key={lib.library} lib={lib} machineId={m.id} machine={m.name} />
              ))}
            </MachineBlock>
          ))}
        </SourcesSection>
      )}
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

/**
 * One slicer of a source in Share to the hub: the catalog source's four lines and Choose brands,
 * or Use as catalog source.
 */
function CatalogSlicer({
  lib,
  list,
  pick,
  id,
  location,
}: {
  lib: LibrarySources;
  list: Integration[];
  pick: { integrationId: string } | { deviceId: string };
  id?: string;
  location?: Integration;
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const locationLabel = useLocationLabel();
  const manage = useCan("catalog", "manage");
  const choose = usePickCatalogSource();
  const name = adapterName(lib.library);
  const source = isSource(lib, pick);
  const cards = source && lib.cardsOf ? list.find((i) => i.id === lib.cardsOf) : undefined;
  const pickable = lib.options.some((o) =>
    "integrationId" in pick
      ? "integrationId" in o && o.integrationId === pick.integrationId
      : "deviceId" in o && o.deviceId === pick.deviceId,
  );
  const unreadable =
    "integrationId" in pick &&
    lib.options.some(
      (o) => "integrationId" in o && o.integrationId === pick.integrationId && !o.readable,
    );
  const meta = [
    location && serverRowsCount(lib, list) > 1 ? locationLabel(location) : null,
    unreadable ? t("settings:sources.catalog.unreadable") : null,
    source && !lib.source?.picked ? t("settings:sources.catalog.picked") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const blocked = "deviceId" in pick && lib.noDevices;
  return (
    <SlicerGroup
      id={id ?? ("deviceId" in pick ? `machine-${pick.deviceId}-${lib.library}` : undefined)}
      name={name}
      badge={source && <SourceBadge>{t("settings:sources.catalog.source")}</SourceBadge>}
      meta={meta || undefined}
      action={
        !source &&
        manage &&
        pickable && (
          <Button
            disabled={choose.isPending}
            aria-label={t("settings:sources.catalog.useAsOf", { slicer: name })}
            onClick={() => choose.mutate({ library: lib.library, pick })}
          >
            {t("settings:sources.catalog.useAs")}
          </Button>
        )
      }
    >
      {source ? (
        <>
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
        </>
      ) : (
        <p className="max-w-prose text-muted">
          {blocked
            ? blocked.reason === "ownSlicer"
              ? t("settings:sources.catalog.ownSlicer")
              : t("settings:sources.catalog.noWorker")
            : t("settings:sources.catalog.notSource")}
        </p>
      )}
      {choose.isError && (
        <p role="alert" className="text-bad">
          {choose.error instanceof ApiError && choose.error.code === "device_outdated"
            ? t("settings:sources.catalog.outdated")
            : t("hub:errors.generic")}
        </p>
      )}
    </SlicerGroup>
  );
}

export const serverRowsCount = (lib: LibrarySources, list: Integration[]) =>
  serverRows(lib, list).length;

/**
 * A machine's `system/` folder line (Receive catalog, ADR-0021): the hub's copy of the catalog
 * source's, written while the slicer is closed, after a backup.
 */
function ReceiveSystem({
  lib,
  machineId,
  machine,
}: {
  lib: LibrarySources;
  machineId: string;
  machine: string;
}) {
  const { t } = useTranslation();
  const name = useAdapterName()(lib.library);
  const m = lib.machines.find((x) => x.deviceId === machineId);
  const s = m?.install;
  const state = (): { state: string; tone?: "warn" } => {
    if (m?.mismatch)
      return { state: t("settings:sources.catalog.mismatch", m.mismatch), tone: "warn" };
    if (!s) return { state: t("settings:sources.catalog.notReceived") };
    if (!s.hub) return { state: t("settings:sources.catalog.noCopy") };
    if (s.error)
      return { state: t("settings:sources.catalog.failed", { error: s.error }), tone: "warn" };
    if (s.waiting) return { state: t("settings:sources.catalog.waiting"), tone: "warn" };
    if (s.fingerprint !== s.hub) return { state: t("settings:sources.catalog.writing") };
    return {
      state: s.backup
        ? t("settings:sources.catalog.received", {
            when: formatDate(s.backup.at),
            fingerprint: s.fingerprint,
          })
        : t("settings:sources.catalog.upToDate", { fingerprint: s.fingerprint }),
    };
  };
  return (
    <SlicerGroup name={name}>
      <StateLines
        label={t("settings:sources.presets.linesOf", { slicer: name, machine })}
        rows={[{ key: "system", item: t("settings:sources.catalog.system"), ...state() }]}
      />
      {s && (
        <details className="text-muted text-sm">
          <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-accent">
            {t("settings:sources.catalog.backup")}
          </summary>
          <p className="wrap-anywhere">
            {s.backup
              ? t("hub:presets.backup", { when: formatDateTime(s.backup.at), path: s.backup.path })
              : t("hub:presets.noBackup")}
          </p>
        </details>
      )}
    </SlicerGroup>
  );
}
