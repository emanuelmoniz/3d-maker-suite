import {
  type Integration,
  type LibrarySources,
  mayEditMachine,
  type PresetDevice,
  SLICER_PRESET_KINDS,
  SLICER_PRESET_TYPES,
  type SlicerPresetKind,
  USER_PRESET_TYPES,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Cable, FileArchive } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { useCan, useMe, useRights } from "../../lib/auth.ts";
import { formatDateTime } from "../../lib/format.ts";
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
import {
  ChangeHubSlicer,
  isSource,
  MachineBlock,
  serverRows,
  serverRowsCount,
} from "./CatalogSources.tsx";
import { LOCATION_ICONS } from "./integrationLabels.ts";
import { PresetsFromZip } from "./ManagedSlicer.tsx";
import {
  DeviceState,
  ReceiveSection,
  type ReceiveSlicer,
  receiversOf,
  SwitchError,
  useSystemLine,
} from "./ReceiveSources.tsx";
import {
  SlicerGroup,
  SourceBadge,
  SourceBlock,
  SourceIcon,
  SourcesSection,
  type StateLine,
  StateLines,
} from "./Sources.tsx";

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

/**
 * Presets settings → Sources (ADR-0021 wireframe 5). Share to the hub: the server's slicer (its
 * system lines while it is the catalog source, and its user lines), accounts that allow user
 * presets, machines with Presets Share per slicer and kind, and the zip. Receive from the hub:
 * every install but the hub's slicer, its Catalog and system presets line and per kind its user
 * presets, with what waits there.
 */
export function PresetSources() {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const hub = !!usePreferences().data?.values.hubEnabled;
  const list = useIntegrations().data;
  const libraries = useCatalogSources().data;
  const devices = usePresetDevices(useCan("presets", "write") && hub).data ?? [];
  const zips = (useZipSources().data ?? []).map((z) => z.id);
  if (!list || !libraries) return null;

  const byLib = (lib: string) => libraries.find((l) => l.library === lib);
  // The server's own install rows and folders, per library: the catalog source's or a user route.
  const server = libraries.flatMap((lib) => {
    const routed = lib.routes.flatMap((r) => list.find((i) => i.id === r.integrationId) ?? []);
    // A worker's own folder holds a zip's copy for its machine: its lines are on the machine's block.
    const rows = [
      ...serverRows(lib, list),
      ...routed.filter((i) => i.kind !== "cloud" && i.kind !== "worker"),
    ];
    return [...new Map(rows.map((i) => [i.id, i])).values()].map((i) => ({ lib, i }));
  });
  const accounts = [
    ...new Map(
      libraries
        .flatMap((lib) => lib.routes)
        .flatMap((r) => list.find((i) => i.id === r.integrationId && i.kind === "cloud") ?? [])
        .map((i) => [i.id, i]),
    ).values(),
  ];
  // A machine shares a slicer with its switch on; the catalog source keeps its system lines here.
  /** A machine's worker row that is a route of the library: its user lines. */
  const workerOf = (d: PresetDevice, l: Library) =>
    byLib(l.library)
      ?.routes.flatMap((r) => list.find((i) => i.id === r.integrationId) ?? [])
      .find((i) => i.kind === "worker" && i.deviceName === d.name);
  // What it shares: its user presets (User presets Share), or the system ones as the hub's slicer.
  const shares = (d: PresetDevice, l: Library) => {
    const lib = byLib(l.library);
    return l.send || (!!lib && isSource(lib, { deviceId: d.id }));
  };
  const sharing = devices.filter((d) => d.libraries.some((l) => shares(d, l)));
  const receivers = receiversOf(libraries, list);
  const zipLibs = admin ? zips : [];
  if (!server.length && !accounts.length && !sharing.length && !receivers.length && !zipLibs.length)
    return (
      <EmptyState
        icon={Cable}
        title={t("settings:sources.empty.presets")}
        description={t("settings:sources.empty.presetsBody")}
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
        {sharing.map((d) => (
          <MachineBlock key={d.id} id={d.id} name={d.name}>
            <DeviceState device={d} />
            {d.libraries
              .filter((l) => shares(d, l))
              .map((l) => (
                <ShareSlicer
                  key={l.library}
                  device={d}
                  library={l}
                  lib={byLib(l.library)}
                  list={list}
                  worker={workerOf(d, l)}
                />
              ))}
          </MachineBlock>
        ))}
        {zipLibs.length > 0 && <ZipBlock libraries={zipLibs} list={list} sources={libraries} />}
      </SourcesSection>
      <ReceiveSection
        receivers={receivers}
        slicer={(sl, r) => {
          const d = devices.find((x) => x.id === sl.machine?.deviceId);
          return (
            <ReceivePresets
              key={sl.lib.library}
              slicer={sl}
              receiver={r.name}
              device={d}
              library={d?.libraries.find((l) => l.library === sl.lib.library)}
            />
          );
        }}
      />
    </>
  );
}

/** The hub's slicer heading's links: Change in Integrations, Choose brands. */
function HubSlicerLinks({ library }: { library: string }) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      <ChangeHubSlicer library={library} />
      <ChooseBrandsLink />
    </span>
  );
}

/** "Choose brands" belongs to Catalog settings (ADR-0021): shown here as a link. */
function ChooseBrandsLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/catalog/settings/sources"
      className="text-sm font-medium text-accent hover:underline"
    >
      {t("settings:sources.presets.chooseBrands")}
    </Link>
  );
}

/** One server install's slicer: its system lines while it is the catalog source, its user lines. */
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
  if (!source && !routed) return null;
  return (
    <SlicerGroup
      id={`server-${lib.library}`}
      name={name}
      badge={source && <SourceBadge>{t("settings:sources.catalog.source")}</SourceBadge>}
      meta={serverRowsCount(lib, list) > 1 ? locationLabel(i) : undefined}
      action={source && <HubSlicerLinks library={lib.library} />}
    >
      <PolicyLines
        integration={i}
        types={[...(source ? SLICER_PRESET_TYPES : []), ...(routed ? USER_PRESET_TYPES : [])]}
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

/** Whether the viewer may turn a machine's preset lines on and off (ADR-0021's `machine.presets`). */
function useMayEdit(d: PresetDevice | undefined) {
  const rights = useRights();
  const me = useMe();
  return !!d && !!rights && mayEditMachine(rights, me?.id, d, "presets");
}

/** A kind line's switch: it writes `shareKinds` / `receiveKinds`; the hub filters (ADR-0021). */
function useKindSwitch(
  d: PresetDevice | undefined,
  l: Library | undefined,
  side: "shareKinds" | "receiveKinds",
) {
  const { t } = useTranslation();
  const actions = useDeviceActions();
  const may = useMayEdit(d);
  const slicer = useAdapterName()(l?.library ?? "");
  return (kind: SlicerPresetKind): NonNullable<StateLine["on"]> => ({
    checked: !!l?.[side].includes(kind),
    label: t(
      side === "shareKinds"
        ? "settings:sources.presets.shareOn"
        : "settings:sources.presets.receiveOn",
      {
        type: t(KINDS[kind]),
        slicer,
        machine: d?.name,
      },
    ),
    disabled: !d || !l || !may || !l.reported || actions.library.isPending,
    set: (on) =>
      l &&
      d &&
      actions.library.mutate({
        id: d.id,
        library: l.library,
        user: {
          [side]: on ? [...l[side], kind] : l[side].filter((k) => k !== kind),
        },
      }),
  });
}

/**
 * One slicer of a sharing machine, in one table: its system lines as the hub's slicer, and its user
 * lines while User presets Share is on, each one's switch being whether the machine sends that kind
 * (Edit and `⋯` are the hub's import of it).
 */
function ShareSlicer({
  device: d,
  library: l,
  lib,
  list,
  worker,
}: {
  device: PresetDevice;
  library: Library;
  lib: LibrarySources | undefined;
  list: Integration[];
  worker: Integration | undefined;
}) {
  const { t } = useTranslation();
  const name = useAdapterName()(l.library);
  const actions = useDeviceActions();
  const kind = useKindSwitch(d, l, "shareKinds");
  const source = !!lib && isSource(lib, { deviceId: d.id });
  const cards = source && lib?.cardsOf ? list.find((i) => i.id === lib.cardsOf) : undefined;
  // Its user lines import what it sends: its own install's row, else the slicer's other route.
  const importer =
    worker ??
    (lib?.routes ?? []).flatMap(
      (r) => list.find((i) => i.id === r.integrationId && i.kind !== "cloud") ?? [],
    )[0];
  const sendState = (k: SlicerPresetKind) =>
    l.shareKinds.includes(k)
      ? t("settings:sources.presets.onSave")
      : t("integrations:policies.modes.off");
  const send = (type: string): SendLine | undefined => {
    const k = KIND_OF[type];
    return k && kind(k);
  };
  const user: string[] = l.send ? [...USER_PRESET_TYPES] : [];
  const lines = (i: Integration, types: string[]) => (
    <PolicyLines
      integration={i}
      types={types as Integration["policies"][number]["type"][]}
      title={name}
      how={false}
      send={send}
    />
  );
  return (
    <SlicerGroup
      id={`machine-${d.id}-${l.library}`}
      name={name}
      badge={source && <SourceBadge>{t("settings:sources.catalog.source")}</SourceBadge>}
      action={source && lib && <HubSlicerLinks library={lib.library} />}
    >
      {!l.reported && (
        <p className="text-muted">{t("settings:sources.presets.notReported", { slicer: name })}</p>
      )}
      {cards && importer?.id === cards.id ? (
        lines(cards, [...SLICER_PRESET_TYPES, ...user])
      ) : (
        <>
          {cards && lines(cards, [...SLICER_PRESET_TYPES])}
          {importer && user.length > 0 && lines(importer, user)}
        </>
      )}
      {/* No install row imports what it sends yet: its kind switches alone. */}
      {!importer && l.send && (
        <StateLines
          label={t("settings:sources.presets.linesOf", { slicer: name, machine: d.name })}
          rows={SLICER_PRESET_KINDS.map((k) => ({
            key: k,
            item: t(KINDS[k]),
            on: kind(k),
            state: sendState(k),
          }))}
        />
      )}
      {l.held > 0 && (
        <Link to="/presets/settings/library" className="w-fit text-warn underline">
          {t("settings:sources.presets.held", { count: l.held })}
        </Link>
      )}
      <SwitchError error={actions.library.error} />
    </SlicerGroup>
  );
}

/**
 * One slicer of a receiver, in one table: its Catalog and system presets line, then a machine's
 * user presets per kind with what waits (while User presets Receive is on), then folder and backup.
 */
function ReceivePresets({
  slicer,
  receiver,
  device: d,
  library: l,
}: {
  slicer: ReceiveSlicer;
  receiver: string;
  /** Its machine's preset switches; none = this server, or no `presets` write. */
  device: PresetDevice | undefined;
  library: Library | undefined;
}) {
  const { t } = useTranslation();
  const name = useAdapterName()(slicer.lib.library);
  const actions = useDeviceActions();
  const kind = useKindSwitch(d, l, "receiveKinds");
  const system = useSystemLine(slicer);
  const s = l?.status;
  // ponytail: per kind from the first 100 queued (`queue`); past that, the total says the rest.
  const queued = (k: SlicerPresetKind) => s?.queue.filter((q) => q.kind === k).length ?? 0;
  const state = (k: SlicerPresetKind) => {
    if (!l?.receiveKinds.includes(k)) return { text: t("integrations:policies.modes.off") };
    if (!s) return { text: t("settings:sources.presets.noReport") };
    const count = queued(k);
    if (!count) return { text: t("settings:sources.presets.upToDate") };
    return {
      text: t(s.waiting ? "settings:sources.presets.waiting" : "settings:sources.presets.queued", {
        count,
      }),
      tone: "warn" as const,
    };
  };
  const queueId = useId();
  const user: StateLine[] = !l
    ? []
    : l.install
      ? SLICER_PRESET_KINDS.map((k) => {
          const { text, tone } = state(k);
          return { key: k, item: t(KINDS[k]), on: kind(k), state: text, tone };
        })
      : // Receive is turned on on the machine page; its kinds show once it is.
        [
          {
            key: "user",
            item: t("settings:sources.presets.user"),
            state: t("settings:sources.presets.userOff"),
          },
        ];
  return (
    <SlicerGroup
      id={`receive-${slicer.machine?.deviceId ?? "server"}-${slicer.lib.library}`}
      name={name}
    >
      {l && !l.reported && (
        <p className="text-muted">{t("settings:sources.presets.notReported", { slicer: name })}</p>
      )}
      <StateLines
        label={t("settings:sources.presets.linesOf", {
          slicer: name,
          machine: receiver || t("settings:sources.server"),
        })}
        rows={[system.row, ...user]}
      />
      {system.after}
      {l && <SwitchError error={actions.library.error} />}
      {s && (
        <div className="grid gap-0.5 text-sm">
          {s.queue.length > 0 && (
            <ul
              id={queueId}
              aria-label={t("hub:presets.queueOf", { name })}
              className="text-muted wrap-anywhere"
            >
              {s.queue.map((q) => (
                <li key={`${q.kind}/${q.name}`}>{q.name}</li>
              ))}
            </ul>
          )}
          {s.editsStayLocal && <p className="text-warn">{t("hub:presets.editsStayLocal")}</p>}
          {s.deleteHere.length > 0 && (
            <>
              <p className="text-warn">
                {t("hub:presets.deleteHere", { count: s.deleteHere.length })}
              </p>
              <ul
                aria-label={t("hub:presets.deleteHereOf", { name })}
                className="text-muted wrap-anywhere"
              >
                {s.deleteHere.map((q) => (
                  <li key={`${q.kind}/${q.name}`}>{q.name}</li>
                ))}
              </ul>
            </>
          )}
          <details className="text-muted">
            <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-accent">
              {t("settings:sources.presets.where")}
            </summary>
            <p className="wrap-anywhere">{t("hub:presets.installFolder", { folder: s.folder })}</p>
            <p className="wrap-anywhere">
              {s.backup
                ? t("hub:presets.backup", {
                    when: formatDateTime(s.backup.at),
                    path: s.backup.path,
                  })
                : t("hub:presets.noBackup")}
            </p>
          </details>
        </div>
      )}
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
