import {
  type Integration,
  type LibrarySources,
  mayEditMachine,
  type PresetDevice,
  SLICER_PRESET_KINDS,
  type SlicerPresetKind,
  type SyncPolicy,
  USER_PRESET_TYPES,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Cable, FileArchive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { useCan, useMe, useRights } from "../../lib/auth.ts";
import { textLink } from "../../lib/cx.ts";
import { useDeviceActions } from "../../lib/hub.ts";
import { useAdapterName, useIntegrations, useLocationLabel } from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useCatalogSources, usePresetDevices } from "../../lib/presets.ts";
import { useZipSources } from "../../lib/slicerCatalog.ts";
import {
  AccountBlock,
  IntegrationsLink,
  PolicyLines,
  type SendLine,
  useAccountTitle,
} from "./AccountSources.tsx";
import { ChooseBrands } from "./ChooseBrands.tsx";
import { LOCATION_ICONS } from "./integrationLabels.ts";
import { PresetsFromZip } from "./ManagedSlicer.tsx";
import { DeviceState, ReceiveSection, receiversOf, SwitchError } from "./ReceiveSources.tsx";
import {
  SlicerGroup,
  SourceBadge,
  SourceBlock,
  SourceIcon,
  SourcesSection,
  type StateLine,
  StateLines,
} from "./Sources.tsx";

type LineType = SyncPolicy["type"];

/** A source's lines, in this order on every card (ADR-0023). */
const LINES: LineType[] = [
  "brands",
  "printerModels",
  "machinePresets",
  "processPresets",
  "filamentBrands",
  "filamentMaterials",
  "filamentPresets",
  ...USER_PRESET_TYPES,
];
/** What the hub's slicer shares: everything but the user presets. */
const SYSTEM = LINES.slice(0, 7);

/** The kind a user preset line is, for a machine's send of it. */
const KIND_OF: Partial<Record<string, SlicerPresetKind>> = {
  userMachinePresets: "machine",
  userProcessPresets: "process",
  userFilamentPresets: "filament",
};

// Written out so `pnpm i18n:check` sees the keys.
const KINDS: Record<SlicerPresetKind, string> = {
  machine: "settings:sources.kinds.machine",
  process: "settings:sources.kinds.process",
  filament: "settings:sources.kinds.filament",
};

type Library = PresetDevice["libraries"][number];

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
const serverRows = (lib: LibrarySources, list: Integration[]) =>
  lib.options.flatMap((o) =>
    "integrationId" in o
      ? (list.find((i) => i.id === o.integrationId && i.kind !== "worker") ?? [])
      : [],
  );

/**
 * Catalog settings → Sources (ADR-0023). Share to the hub: this server's slicers, the accounts that
 * have user presets, the machines with a slicer (the hub's slicer, or one it reports) and the
 * zip, each slicer one table of its lines. Receive from the hub: every other install, per slicer its
 * System and User presets lines.
 */
export function CatalogSources() {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const hub = !!usePreferences().data?.values.hubEnabled;
  const list = useIntegrations().data;
  const libraries = useCatalogSources().data;
  const devices = usePresetDevices(useCan("catalog", "write") && hub).data ?? [];
  const zips = (useZipSources().data ?? []).map((z) => z.id);
  if (!list || !libraries) return null;

  // The server's own install rows and folders, per library: the hub's slicer or a user route.
  const server = libraries.flatMap((lib) => {
    const routed = lib.routes.flatMap((r) => list.find((i) => i.id === r.integrationId) ?? []);
    // A worker's own folder holds a zip's copy for its machine: its lines are on the machine's card.
    const rows = [
      ...serverRows(lib, list),
      ...routed.filter((i) => i.kind !== "cloud" && i.kind !== "worker"),
    ];
    return [...new Map(rows.map((i) => [i.id, i])).values()]
      .filter(
        (i) =>
          isSource(lib, { integrationId: i.id }) ||
          lib.routes.some((r) => r.integrationId === i.id),
      )
      .map((i) => ({ lib, i }));
  });
  const accounts = [
    ...new Map(
      libraries
        .flatMap((lib) => lib.routes)
        .flatMap((r) => list.find((i) => i.id === r.integrationId && i.kind === "cloud") ?? [])
        .map((i) => [i.id, i]),
    ).values(),
  ];
  // A machine shares a slicer as the hub's slicer, or its user presets from one it reports (or still
  // sends). The first is known to anyone; the second only with `catalog` write (`devices`).
  const machines = new Map<string, { name: string; libraries: string[] }>();
  const add = (id: string, name: string, library: string) => {
    const m = machines.get(id) ?? { name, libraries: [] };
    if (!m.libraries.includes(library)) m.libraries.push(library);
    machines.set(id, m);
  };
  for (const lib of libraries)
    for (const m of lib.machines)
      if (isSource(lib, { deviceId: m.deviceId })) add(m.deviceId, m.name, lib.library);
  for (const d of devices)
    for (const l of d.libraries) if (l.reported || l.send) add(d.id, d.name, l.library);
  const receivers = receiversOf(libraries, list);
  const zipLibs = admin ? zips : [];
  if (!server.length && !accounts.length && !machines.size && !receivers.length && !zipLibs.length)
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
              <ServerSlicer key={`${lib.library}-${i.id}`} lib={lib} integration={i} list={list} />
            ))}
          </SourceBlock>
        )}
        {accounts.map((i) => (
          <AccountPresets key={i.id} integration={i} libraries={libraries} />
        ))}
        {[...machines].map(([id, m]) => {
          const d = devices.find((x) => x.id === id);
          return (
            <MachineBlock key={id} id={id} name={m.name}>
              {d && <DeviceState device={d} />}
              {m.libraries.map((library) => (
                <ShareSlicer
                  key={library}
                  id={id}
                  device={d}
                  library={library}
                  lib={libraries.find((l) => l.library === library)}
                  list={list}
                />
              ))}
            </MachineBlock>
          );
        })}
        {zipLibs.length > 0 && <ZipBlock libraries={zipLibs} list={list} sources={libraries} />}
      </SourcesSection>
      <ReceiveSection receivers={receivers} devices={devices} />
    </>
  );
}

/** A machine's card, linking back to its page. */
export function MachineBlock({
  id,
  name,
  subtitle,
  receive,
  children,
}: {
  id: string;
  name: string;
  /** Its user, where it matters whose machine it is. */
  subtitle?: string;
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
      subtitle={subtitle}
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

/** "Change in Integrations" on the hub's slicer heading: it is picked there (ADR-0022). */
function ChangeHubSlicer({ library }: { library: string }) {
  const { t } = useTranslation();
  if (!useCan("integrations.manage")) return null;
  return (
    <Link to="/integrations" hash={`library-${library}`} className={`text-sm ${textLink}`}>
      {t("settings:sources.catalog.change")}
    </Link>
  );
}

/** Choose brands under the hub's slicer heading, for who manages the catalog. */
function Brands({ integration }: { integration: Integration | undefined }) {
  const manage = useCan("catalog", "manage");
  if (!integration || !manage || !integration.capabilities.includes("brands")) return null;
  return <ChooseBrands integration={integration} />;
}

/** One server install's slicer: its system lines while it is the hub's slicer, its user lines. */
function ServerSlicer({
  lib,
  integration: i,
  list,
}: {
  lib: LibrarySources;
  integration: Integration;
  list: Integration[];
}) {
  const { t } = useTranslation();
  const name = useAdapterName()(lib.library);
  const locationLabel = useLocationLabel();
  const source = isSource(lib, { integrationId: i.id });
  const routed = lib.routes.some((r) => r.integrationId === i.id);
  const unreadable =
    source &&
    lib.options.some((o) => "integrationId" in o && o.integrationId === i.id && !o.readable);
  return (
    <SlicerGroup
      id={`server-${lib.library}`}
      name={name}
      badge={source && <SourceBadge>{t("settings:sources.catalog.source")}</SourceBadge>}
      meta={
        unreadable
          ? t("settings:sources.catalog.unreadable")
          : serverRows(lib, list).length > 1
            ? locationLabel(i)
            : undefined
      }
      action={source && <ChangeHubSlicer library={lib.library} />}
    >
      {source && <Brands integration={i} />}
      <PolicyLines
        integration={i}
        types={LINES.filter(
          (type) => (source && SYSTEM.includes(type)) || (routed && !SYSTEM.includes(type)),
        )}
        title={name}
        how={false}
      />
    </SlicerGroup>
  );
}

/** An account that allows user presets: its user lines, per library its presets go to. */
function AccountPresets({
  integration: i,
  libraries,
}: {
  integration: Integration;
  libraries: LibrarySources[];
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const title = useAccountTitle()(i);
  const libs = libraries.filter((l) => l.routes.some((r) => r.integrationId === i.id));
  return (
    <AccountBlock integration={i} types={[...USER_PRESET_TYPES]}>
      {libs.map((lib) => (
        <SlicerGroup key={lib.library} name={adapterName(lib.library)}>
          <PolicyLines integration={i} types={[...USER_PRESET_TYPES]} title={title} how={false} />
        </SlicerGroup>
      ))}
      <p className="max-w-prose text-muted">{t("integrations:policies.cloudPresetsRoute")}</p>
    </AccountBlock>
  );
}

/** Whether the viewer may turn a machine's preset lines on and off (`machine.catalog`, ADR-0023). */
export function useMayEdit(d: PresetDevice | undefined) {
  const rights = useRights();
  const me = useMe();
  return !!d && !!rights && mayEditMachine(rights, me?.id, d, "catalog");
}

/**
 * A Share kind line's switch: it writes `shareKinds`, and User presets Share is on while any kind
 * is (the connector sends, the hub filters, ADR-0021).
 */
function useKindSwitch(d: PresetDevice | undefined, l: Library | undefined) {
  const { t } = useTranslation();
  const actions = useDeviceActions();
  const may = useMayEdit(d);
  const slicer = useAdapterName()(l?.library ?? "");
  return (kind: SlicerPresetKind): SendLine => ({
    checked: !!l?.send && l.shareKinds.includes(kind),
    label: t("settings:sources.presets.shareOn", {
      type: t(KINDS[kind]),
      slicer,
      machine: d?.name,
    }),
    disabled: !d || !l || !may || !l.reported || actions.library.isPending,
    set: (on) => {
      if (!l || !d) return;
      const kinds = l.send ? l.shareKinds : [];
      const shareKinds = on ? [...kinds, kind] : kinds.filter((k) => k !== kind);
      actions.library.mutate({
        id: d.id,
        library: l.library,
        user: { share: shareKinds.length > 0, shareKinds },
      });
    },
  });
}

/**
 * One slicer of a machine, in one table: its system lines as the hub's slicer, and its user lines,
 * each one's switch being whether the machine sends that kind (Edit and `⋯` are the hub's import of
 * it). Without `device` (no `catalog` write), only the first.
 */
function ShareSlicer({
  id,
  device: d,
  library,
  lib,
  list,
}: {
  id: string;
  device: PresetDevice | undefined;
  library: string;
  lib: LibrarySources | undefined;
  list: Integration[];
}) {
  const { t } = useTranslation();
  const name = useAdapterName()(library);
  const actions = useDeviceActions();
  const l = d?.libraries.find((x) => x.library === library);
  const kind = useKindSwitch(d, l);
  const source = !!lib && isSource(lib, { deviceId: id });
  const cards = source && lib?.cardsOf ? list.find((i) => i.id === lib.cardsOf) : undefined;
  const routes = (lib?.routes ?? []).flatMap(
    (r) => list.find((i) => i.id === r.integrationId) ?? [],
  );
  // Its user lines import what it sends: its own install's row, else the slicer's other route.
  const importer =
    routes.find((i) => i.kind === "worker" && i.deviceName === d?.name) ??
    routes.find((i) => i.kind !== "cloud");
  const user = l ? LINES.filter((type) => !SYSTEM.includes(type)) : [];
  const send = (type: LineType) => {
    const k = KIND_OF[type];
    return k && kind(k);
  };
  const lines = (i: Integration, types: LineType[]) => (
    <PolicyLines integration={i} types={types} title={name} how={false} send={send} />
  );
  return (
    <SlicerGroup
      id={`machine-${id}-${library}`}
      name={name}
      badge={source && <SourceBadge>{t("settings:sources.catalog.source")}</SourceBadge>}
      action={source && <ChangeHubSlicer library={library} />}
    >
      {l && !l.reported && (
        <p className="text-muted">{t("settings:sources.presets.notReported", { slicer: name })}</p>
      )}
      {source && (
        <p className="max-w-prose text-muted">{t("settings:sources.catalog.fromDevice")}</p>
      )}
      <Brands integration={cards} />
      {cards && importer?.id === cards.id ? (
        lines(cards, [...SYSTEM, ...user])
      ) : (
        <>
          {cards && lines(cards, SYSTEM)}
          {importer && user.length > 0 && lines(importer, user)}
        </>
      )}
      {/* No install row imports what it sends yet: its kind switches alone. */}
      {!importer && d && l && (
        <StateLines
          label={t("settings:sources.presets.linesOf", { slicer: name, machine: d.name })}
          rows={SLICER_PRESET_KINDS.map(
            (k): StateLine => ({
              key: k,
              item: t(KINDS[k]),
              on: kind(k),
              state:
                l.send && l.shareKinds.includes(k)
                  ? t("settings:sources.presets.onSave")
                  : t("integrations:policies.modes.off"),
            }),
          )}
        />
      )}
      {l && l.held > 0 && (
        <Link
          to="/catalog/settings/library"
          className="w-fit font-medium text-warn hover:underline"
        >
          {t("settings:sources.presets.held", { count: l.held })}
        </Link>
      )}
      {d && <SwitchError error={actions.library.error} />}
    </SlicerGroup>
  );
}

/** "No connector? Upload a zip", under Share to the hub: a desktop install's config folder. */
function ZipBlock({
  libraries,
  list,
  sources,
}: {
  libraries: string[];
  list: Integration[];
  sources: LibrarySources[];
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  return (
    <SourceBlock
      id="zip"
      icon={<SourceIcon icon={FileArchive} />}
      title={t("settings:sources.presets.zip")}
    >
      {libraries.map((library) => {
        const routes = (sources.find((l) => l.library === library)?.routes ?? []).flatMap(
          (r) => list.find((i) => i.id === r.integrationId) ?? [],
        );
        return (
          <SlicerGroup key={library} id={`zip-${library}`} name={adapterName(library)}>
            {/* A server slicer or a worker has no folder of yours to read: the zip is the way in. */}
            <PresetsFromZip
              libraryId={library}
              noFolder={
                routes.some((i) => i.kind === "server" || i.kind === "worker") &&
                !routes.some((i) => i.kind === "local")
              }
            />
          </SlicerGroup>
        );
      })}
    </SourceBlock>
  );
}
