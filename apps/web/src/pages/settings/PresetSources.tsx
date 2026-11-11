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
import { Cable } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan, useMe, useRights } from "../../lib/auth.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useDeviceActions } from "../../lib/hub.ts";
import { useAdapterName, useIntegrations, useLocationLabel } from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useCatalogSources, usePresetDevices } from "../../lib/presets.ts";
import { useZipSources } from "../../lib/slicerCatalog.ts";
import { AccountBlock, IntegrationsLink, PolicyLines, useAccountTitle } from "./AccountSources.tsx";
import { isSource, MachineBlock, serverRows, serverRowsCount } from "./CatalogSources.tsx";
import { PresetsFromZip } from "./ManagedSlicer.tsx";
import {
  SlicerGroup,
  SourceBadge,
  SourceBlock,
  SourcesSection,
  type StateLine,
  StateLines,
} from "./Sources.tsx";

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
 * machines with Presets Receive, per slicer and kind, with what waits there.
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
  const shares = (d: PresetDevice, l: Library) => {
    const lib = byLib(l.library);
    return l.send || (!!lib && isSource(lib, { deviceId: d.id })) || !!workerOf(d, l);
  };
  const sharing = devices.filter((d) => d.libraries.some((l) => shares(d, l)));
  const receiving = devices.filter((d) => d.libraries.some((l) => l.install));
  const zipLibs = admin ? zips : [];
  if (!server.length && !accounts.length && !sharing.length && !receiving.length && !zipLibs.length)
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
      <SourcesSection
        direction="share"
        footer={
          zipLibs.length > 0 && <ZipFooter libraries={zipLibs} list={list} sources={libraries} />
        }
      >
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
      </SourcesSection>
      {receiving.length > 0 && (
        <SourcesSection direction="receive">
          {receiving.map((d) => (
            <MachineBlock key={d.id} id={d.id} name={d.name} receive>
              <DeviceState device={d} />
              {d.libraries
                .filter((l) => l.install)
                .map((l) => (
                  <ReceiveSlicer key={l.library} device={d} library={l} />
                ))}
            </MachineBlock>
          ))}
        </SourcesSection>
      )}
    </>
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
      action={source && <ChooseBrandsLink />}
    >
      <PolicyLines
        integration={i}
        types={[...(source ? SLICER_PRESET_TYPES : []), ...(routed ? USER_PRESET_TYPES : [])]}
        title={name}
        what={false}
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
          <PolicyLines
            integration={i}
            types={[...USER_PRESET_TYPES]}
            title={title}
            what={false}
            how={false}
          />
        </SlicerGroup>
      ))}
      <p className="max-w-prose text-muted">{t("integrations:policies.cloudPresetsRoute")}</p>
    </AccountBlock>
  );
}

/** A machine's state that holds for every line: offline, connector too old. */
function DeviceState({ device: d }: { device: PresetDevice }) {
  const { t } = useTranslation();
  if (d.online && !d.outdated) return null;
  return (
    <p className={d.outdated ? "text-warn" : "text-muted"}>
      {d.outdated ? t("hub:presets.deviceOutdated") : t("hub:presets.deviceOffline")}
    </p>
  );
}

/** Whether the viewer may turn a machine's preset lines on and off (ADR-0021's `machine.presets`). */
function useMayEdit(d: PresetDevice) {
  const rights = useRights();
  const me = useMe();
  return !!rights && mayEditMachine(rights, me?.id, d, "presets");
}

/** A kind line's switch: it writes `shareKinds` / `receiveKinds`; the hub filters (ADR-0021). */
function useKindSwitch(d: PresetDevice, l: Library, side: "shareKinds" | "receiveKinds") {
  const { t } = useTranslation();
  const actions = useDeviceActions();
  const may = useMayEdit(d);
  const slicer = useAdapterName()(l.library);
  return (kind: SlicerPresetKind): StateLine["on"] => ({
    checked: l[side].includes(kind),
    label: t(
      side === "shareKinds"
        ? "settings:sources.presets.shareOn"
        : "settings:sources.presets.receiveOn",
      {
        type: t(KINDS[kind]),
        slicer,
        machine: d.name,
      },
    ),
    disabled: !may || !l.reported || actions.library.isPending,
    set: (on) =>
      actions.library.mutate({
        id: d.id,
        library: l.library,
        presets: {
          [side]: on ? [...l[side], kind] : l[side].filter((k) => k !== kind),
        },
      }),
  });
}

/** The error of a kind switch, once per slicer. */
function SwitchError({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p role="alert" className="text-bad">
      {error instanceof ApiError && error.code === "device_outdated"
        ? t("settings:sources.presets.outdated")
        : t("hub:errors.generic")}
    </p>
  );
}

/** One slicer of a sharing machine: its system lines if it is the catalog source, a line per kind. */
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
  return (
    <SlicerGroup
      id={`machine-${d.id}-${l.library}`}
      name={name}
      badge={source && <SourceBadge>{t("settings:sources.catalog.source")}</SourceBadge>}
      meta={
        l.send
          ? l.sentAt
            ? t("settings:sources.presets.sentAt", { when: formatDateTime(l.sentAt) })
            : t("settings:sources.presets.neverSent")
          : undefined
      }
      action={source && <ChooseBrandsLink />}
    >
      {!l.reported && (
        <p className="text-muted">{t("settings:sources.presets.notReported", { slicer: name })}</p>
      )}
      {(cards || worker) && (
        // One table when the worker row holds both: its system lines and its zip's user lines.
        <>
          {cards && cards.id !== worker?.id && (
            <PolicyLines
              integration={cards}
              types={[...SLICER_PRESET_TYPES]}
              title={name}
              what={false}
              how={false}
            />
          )}
          {worker && (
            <PolicyLines
              integration={worker}
              types={[
                ...(cards?.id === worker.id ? SLICER_PRESET_TYPES : []),
                ...USER_PRESET_TYPES,
              ]}
              title={name}
              what={false}
              how={false}
            />
          )}
        </>
      )}
      {l.send && (
        <StateLines
          label={t("settings:sources.presets.linesOf", { slicer: name, machine: d.name })}
          rows={SLICER_PRESET_KINDS.map((k) => ({
            key: k,
            item: t(KINDS[k]),
            on: kind(k),
            state: l.shareKinds.includes(k)
              ? t("settings:sources.presets.onSave")
              : t("integrations:policies.modes.off"),
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

/** One slicer of a receiving machine: a line per kind with what waits, then its folder and backup. */
function ReceiveSlicer({ device: d, library: l }: { device: PresetDevice; library: Library }) {
  const { t } = useTranslation();
  const name = useAdapterName()(l.library);
  const actions = useDeviceActions();
  const kind = useKindSwitch(d, l, "receiveKinds");
  const s = l.status;
  // ponytail: per kind from the first 100 queued (`queue`); past that, the total says the rest.
  const queued = (k: SlicerPresetKind) => s?.queue.filter((q) => q.kind === k).length ?? 0;
  const state = (k: SlicerPresetKind) => {
    if (!l.receiveKinds.includes(k)) return { text: t("integrations:policies.modes.off") };
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
  return (
    <SlicerGroup id={`receive-${d.id}-${l.library}`} name={name}>
      {!l.reported && (
        <p className="text-muted">{t("settings:sources.presets.notReported", { slicer: name })}</p>
      )}
      <StateLines
        label={t("settings:sources.presets.linesOf", { slicer: name, machine: d.name })}
        rows={SLICER_PRESET_KINDS.map((k) => {
          const { text, tone } = state(k);
          return { key: k, item: t(KINDS[k]), on: kind(k), state: text, tone };
        })}
      />
      <SwitchError error={actions.library.error} />
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
function ZipFooter({
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
  const heading = useId();
  return (
    <section
      id="zip"
      aria-labelledby={heading}
      className="grid scroll-mt-4 gap-4 border-t border-border pt-5"
    >
      <h3 id={heading} className="text-base font-semibold">
        {t("settings:sources.presets.zip")}
      </h3>
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
    </section>
  );
}
