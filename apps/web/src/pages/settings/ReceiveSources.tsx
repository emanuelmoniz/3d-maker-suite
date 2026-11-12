import {
  type CatalogInstallSlicer,
  type Integration,
  type LibrarySources,
  mayEditMachine,
  type PresetDevice,
} from "@3d-maker-suite/core";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { Menu } from "../../components/Menu.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan, useMe, useRights } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useDeviceActions } from "../../lib/hub.ts";
import { useAdapterName, usePatchIntegration } from "../../lib/integrations.ts";
import { isSource, MachineBlock, useMayEdit } from "./CatalogSources.tsx";
import { LOCATION_ICONS } from "./integrationLabels.ts";
import {
  SlicerGroup,
  SourceBlock,
  SourceIcon,
  SourcesSection,
  type StateLine,
  StateLines,
} from "./Sources.tsx";

type Machine = LibrarySources["machines"][number];

/** One slicer of a receiver: a machine's (by its `LibrarySources` entry) or this server's install. */
export type ReceiveSlicer = { lib: LibrarySources } & (
  | { machine: Machine; integration?: never }
  | { integration: Integration; machine?: never }
);

type Receiver = {
  id: string;
  name: string;
  machine?: { online: boolean; outdated: boolean };
  slicers: ReceiveSlicer[];
};

/**
 * Who can receive (ADR-0022): this server's own installs and every machine with the slicer. The
 * hub's slicer is one too, for user presets only: its own folder is the catalog.
 */
export function receiversOf(libraries: LibrarySources[], list: Integration[]): Receiver[] {
  const server: Receiver = { id: "server", name: "", slicers: [] };
  const machines = new Map<string, Receiver>();
  for (const lib of libraries) {
    for (const i of list)
      if (i.kind === "local" && i.presetLibrary === lib.library)
        server.slicers.push({ lib, integration: i });
    for (const m of lib.machines) {
      const r = machines.get(m.deviceId) ?? {
        id: m.deviceId,
        name: m.name,
        machine: { online: m.online, outdated: m.outdated },
        slicers: [],
      };
      r.slicers.push({ lib, machine: m });
      machines.set(m.deviceId, r);
    }
  }
  return [...(server.slicers.length ? [server] : []), ...machines.values()];
}

/** Receive from the hub, on Catalog settings → Sources: a card per receiver, its lines per slicer. */
export function ReceiveSection({
  receivers,
  devices,
}: {
  receivers: Receiver[];
  /** The machines' preset switches; none without `catalog` write. */
  devices: PresetDevice[];
}) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  if (!receivers.length) return null;
  const slicers = (r: Receiver) =>
    r.slicers.map((s) => {
      const d = devices.find((x) => x.id === s.machine?.deviceId);
      return (
        <ReceiveLines
          key={s.lib.library}
          slicer={s}
          receiver={r.name}
          device={d}
          library={d?.libraries.find((l) => l.library === s.lib.library)}
        />
      );
    });
  return (
    <SourcesSection direction="receive">
      {receivers.map((r) =>
        r.machine ? (
          <MachineBlock key={r.id} id={r.id} name={r.name} receive>
            <DeviceState device={r.machine} />
            {slicers(r)}
          </MachineBlock>
        ) : (
          <SourceBlock
            key={r.id}
            id="receive-server"
            icon={<SourceIcon icon={LOCATION_ICONS.server} />}
            title={t("settings:sources.server")}
            link={
              admin
                ? { to: "/integrations", label: t("settings:sources.toIntegrations") }
                : undefined
            }
          >
            {slicers(r)}
          </SourceBlock>
        ),
      )}
    </SourcesSection>
  );
}

/** A machine's state that holds for every line: offline, connector too old. */
export function DeviceState({ device: d }: { device: { online: boolean; outdated: boolean } }) {
  const { t } = useTranslation();
  if (d.online && !d.outdated) return null;
  return (
    <p className={d.outdated ? "text-warn" : "text-muted"}>
      {d.outdated ? t("hub:presets.deviceOutdated") : t("hub:presets.deviceOffline")}
    </p>
  );
}

/** A switch's error, once per slicer. */
export function SwitchError({ error }: { error: Error | null }) {
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

/**
 * A receiver's Catalog and system presets line (ADR-0021): its Receive switch (a machine's
 * `system.receive` with `machine.catalog`, this server's `catalogReceive` with integrations.manage)
 * and its `system/` state; then where its backup is, and the switch's error.
 */
export function useSystemLine({ lib, machine: m, integration: i }: ReceiveSlicer) {
  const { t } = useTranslation();
  const slicer = useAdapterName()(lib.library);
  const rights = useRights();
  const me = useMe();
  const admin = useCan("integrations.manage");
  const device = useDeviceActions().library;
  const patch = usePatchIntegration(i?.id ?? "");
  const receive = m ? m.receive : !!i?.catalogReceive;
  const s: CatalogInstallSlicer | null | undefined = m ? m.install : i?.catalogInstall;
  // The hub's slicer's own folder is the catalog: nothing to receive, no switch.
  const hub = isSource(lib, m ? { deviceId: m.deviceId } : { integrationId: i?.id });
  const may = !hub && (m ? !!rights && mayEditMachine(rights, me?.id, m, "catalog") : admin);
  const state = (): { state: string; tone?: "warn" } => {
    if (hub) return { state: t("settings:sources.catalog.source") };
    if (!receive) return { state: t("integrations:policies.modes.off") };
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
        ? t("settings:sources.catalog.received", { when: formatDate(s.backup.at) })
        : t("settings:sources.catalog.upToDate"),
    };
  };
  const row: StateLine = {
    key: "system",
    item: t("settings:sources.catalog.item"),
    // As on the machine page: no switch without the right, its state says Off or what it got.
    on: may
      ? {
          checked: receive,
          label: t("settings:sources.catalog.receiveOn", {
            slicer,
            machine: m ? m.name : t("settings:sources.server"),
          }),
          disabled: device.isPending || patch.isPending,
          set: (on) =>
            m
              ? device.mutate({ id: m.deviceId, library: lib.library, system: { receive: on } })
              : patch.mutate({ catalogReceive: on }),
        }
      : undefined,
    ...state(),
  };
  return { row, status: !hub && receive ? s : null, error: m ? device.error : patch.error };
}

/**
 * One slicer of a receiver, in one table (ADR-0023): its System presets line, then its User presets
 * line (every kind) with what waits; each line's `⋯` tells what it received and its backup.
 */
function ReceiveLines({
  slicer,
  receiver,
  device: d,
  library: l,
}: {
  slicer: ReceiveSlicer;
  receiver: string;
  /** Its machine's preset switches; none = this server, or no `catalog` write. */
  device: PresetDevice | undefined;
  library: PresetDevice["libraries"][number] | undefined;
}) {
  const { t } = useTranslation();
  const name = useAdapterName()(slicer.lib.library);
  const actions = useDeviceActions();
  const mayMachine = useMayEdit(d);
  const admin = useCan("integrations.manage");
  const i = slicer.integration;
  const patch = usePatchIntegration(i?.id ?? "");
  const system = useSystemLine(slicer);
  // A machine's switch and report (5.1.0), or this server's install's (5.5.0 Step 11i).
  const u = i
    ? {
        install: !!i.presetReceive,
        status: i.presetInstall ?? null,
        reported: true,
        may: admin,
        pending: patch.isPending,
        error: patch.error,
        set: (on: boolean) => patch.mutate({ presetReceive: on }),
      }
    : l && d
      ? {
          install: l.install,
          status: l.status,
          reported: l.reported,
          may: mayMachine,
          pending: actions.library.isPending,
          error: actions.library.error,
          set: (on: boolean) =>
            actions.library.mutate({ id: d.id, library: l.library, user: { receive: on } }),
        }
      : undefined;
  const s = u?.status;
  const state = (): { state: string; tone?: "warn" } => {
    if (!u?.install) return { state: t("integrations:policies.modes.off") };
    if (!s) return { state: t("settings:sources.presets.noReport") };
    if (!s.queued) return { state: t("settings:sources.presets.upToDate") };
    const key = s.waiting ? "settings:sources.presets.waiting" : "settings:sources.presets.queued";
    return { state: t(key, { count: s.queued }), tone: "warn" };
  };
  const where = receiver || t("settings:sources.server");
  if (system.status)
    system.row.menu = (
      <ReceiveMenu type={t("settings:sources.catalog.item")} slicer={name} receiver={where}>
        <SystemDetails status={system.status} />
      </ReceiveMenu>
    );
  const user: StateLine[] = !u
    ? []
    : [
        {
          key: "user",
          menu: s && (
            <ReceiveMenu type={t("settings:sources.presets.user")} slicer={name} receiver={where}>
              <dl className="grid gap-1 text-sm">
                <dd className="wrap-anywhere">
                  {t("hub:presets.installFolder", { folder: s.folder })}
                </dd>
                <dd className="wrap-anywhere text-muted">
                  <BackupText backup={s.backup} />
                </dd>
              </dl>
            </ReceiveMenu>
          ),
          item: t("settings:sources.presets.user"),
          // As on the machine page: no switch without the right, its state says Off or what waits.
          on: u.may
            ? {
                checked: u.install,
                label: t("settings:sources.presets.receiveOn", {
                  slicer: name,
                  machine: d?.name ?? t("settings:sources.server"),
                }),
                disabled: !u.reported || u.pending,
                set: u.set,
              }
            : undefined,
          ...state(),
        },
      ];
  return (
    <SlicerGroup
      id={`receive-${slicer.machine?.deviceId ?? "server"}-${slicer.lib.library}`}
      name={name}
    >
      {u && !u.reported && (
        <p className="text-muted">{t("settings:sources.presets.notReported", { slicer: name })}</p>
      )}
      <StateLines
        label={t("settings:sources.presets.linesOf", { slicer: name, machine: where })}
        rows={[system.row, ...user]}
      />
      <SwitchError error={system.error ?? u?.error ?? null} />
      {s && (s.queue.length > 0 || s.editsStayLocal || s.deleteHere.length > 0) && (
        <div className="grid gap-0.5 text-sm">
          {s.queue.length > 0 && (
            <ul
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
        </div>
      )}
    </SlicerGroup>
  );
}

function BackupText({ backup }: { backup: { path: string; at: string } | null }) {
  const { t } = useTranslation();
  return backup
    ? t("hub:presets.backup", { when: formatDateTime(backup.at), path: backup.path })
    : t("hub:presets.noBackup");
}

/** A receive line's `⋯`, as a Share line's: What is received opens its details. */
function ReceiveMenu({
  type,
  slicer,
  receiver,
  children,
}: {
  type: string;
  slicer: string;
  receiver: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const of = { type, slicer, machine: receiver };
  return (
    <>
      <Menu label={t("settings:sources.receiveMenu", of)}>
        <Button variant="ghost" className="justify-start" onClick={() => setOpen(true)}>
          {t("settings:sources.received")}
        </Button>
      </Menu>
      <AddDialog
        open={open}
        wide
        title={t("settings:sources.receivedTitle", of)}
        onClose={() => setOpen(false)}
      >
        {children}
      </AddDialog>
    </>
  );
}

/** `Vendor=version;…` (a catalog fingerprint) → vendor → version. */
const versions = (fingerprint: string | null) =>
  new Map(
    (fingerprint ?? "")
      .split(";")
      .filter(Boolean)
      .map((v) => {
        const at = v.indexOf("=");
        return at < 0 ? [v, ""] : [v.slice(0, at), v.slice(at + 1)];
      }),
  );

/** The hub's copy and this slicer's `system/`, per vendor, then the last backup. */
function SystemDetails({ status: s }: { status: CatalogInstallSlicer }) {
  const { t } = useTranslation();
  const hub = versions(s.hub);
  const here = versions(s.fingerprint);
  const rows = [...new Set([...hub.keys(), ...here.keys()])]
    .sort((a, b) => a.localeCompare(b))
    .map((vendor) => ({ vendor, hub: hub.get(vendor), here: here.get(vendor) }));
  return (
    <div className="grid gap-3">
      {rows.length > 0 && (
        <DataTable
          label={t("settings:sources.catalog.versions")}
          rows={rows}
          rowKey={(r) => r.vendor}
          columns={[
            {
              id: "vendor",
              header: t("settings:sources.catalog.vendor"),
              cell: (r) => <span className="font-medium">{r.vendor}</span>,
            },
            {
              id: "hub",
              header: t("settings:sources.catalog.hubCopy"),
              cell: (r) => r.hub ?? "—",
            },
            {
              id: "here",
              header: t("settings:sources.catalog.here"),
              cell: (r) => (
                <span className={cx(r.here !== r.hub && "text-warn")}>{r.here ?? "—"}</span>
              ),
            },
          ]}
        />
      )}
      <p className="wrap-anywhere text-sm text-muted">
        <BackupText backup={s.backup} />
      </p>
    </div>
  );
}
