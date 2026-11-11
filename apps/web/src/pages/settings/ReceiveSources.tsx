import {
  type CatalogInstallSlicer,
  type Integration,
  type LibrarySources,
  mayEditMachine,
} from "@3d-maker-suite/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api.ts";
import { useCan, useMe, useRights } from "../../lib/auth.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useDeviceActions } from "../../lib/hub.ts";
import { useAdapterName, usePatchIntegration } from "../../lib/integrations.ts";
import { isSource, MachineBlock } from "./CatalogSources.tsx";
import { LOCATION_ICONS } from "./integrationLabels.ts";
import { SourceBlock, SourceIcon, SourcesSection, type StateLine } from "./Sources.tsx";

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
 * Who can receive (ADR-0022): this server's own installs and every machine with the slicer, all
 * but the hub's slicer, whose own folder is the catalog.
 */
export function receiversOf(libraries: LibrarySources[], list: Integration[]): Receiver[] {
  const server: Receiver = { id: "server", name: "", slicers: [] };
  const machines = new Map<string, Receiver>();
  for (const lib of libraries) {
    for (const i of list)
      if (
        i.kind === "local" &&
        i.presetLibrary === lib.library &&
        !isSource(lib, { integrationId: i.id })
      )
        server.slicers.push({ lib, integration: i });
    for (const m of lib.machines) {
      if (isSource(lib, { deviceId: m.deviceId })) continue;
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

/** Receive from the hub, on Catalog settings → Sources and Preset sources: a card per receiver, `slicer` per slicer. */
export function ReceiveSection({
  receivers,
  slicer,
}: {
  receivers: Receiver[];
  slicer: (s: ReceiveSlicer, receiver: Receiver) => ReactNode;
}) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  if (!receivers.length) return null;
  return (
    <SourcesSection direction="receive">
      {receivers.map((r) =>
        r.machine ? (
          <MachineBlock key={r.id} id={r.id} name={r.name} receive>
            <DeviceState device={r.machine} />
            {r.slicers.map((s) => slicer(s, r))}
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
            {r.slicers.map((s) => slicer(s, r))}
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
  const may = m ? !!rights && mayEditMachine(rights, me?.id, m, "catalog") : admin;
  const state = (): { state: string; tone?: "warn" } => {
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
        ? t("settings:sources.catalog.received", {
            when: formatDate(s.backup.at),
            fingerprint: s.fingerprint,
          })
        : t("settings:sources.catalog.upToDate", { fingerprint: s.fingerprint }),
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
  const after = (
    <>
      {receive && s && (
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
      <SwitchError error={m ? device.error : patch.error} />
    </>
  );
  return { row, after };
}
