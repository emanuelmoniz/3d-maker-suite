import {
  type Device,
  type MachineSection,
  mayEditMachine,
  type PairingCode,
} from "@3d-maker-suite/core";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { cardGrid, Section } from "../../components/Section.tsx";
import { Switch } from "../../components/Switch.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan, useMe, useRights } from "../../lib/auth.ts";
import { textLink } from "../../lib/cx.ts";
import { formatDateTime, formatTime } from "../../lib/format.ts";
import {
  useConnectorActions,
  useConnectorSettings,
  useDeviceActions,
  useDevices,
} from "../../lib/hub.ts";
import { useAdapterName } from "../../lib/integrations.ts";
import { CONNECTOR_PORT, useConnectorId } from "../../lib/projects.ts";
import { useUsers } from "../../lib/users.ts";
import { SourceBadge, SyncSources } from "../settings/Sources.tsx";
import { SyncLine } from "./SyncLine.tsx";

// Written out so `pnpm i18n:check` sees the keys.
const ERRORS: Record<string, string> = {
  device_offline: "hub:edit.offline",
  device_outdated: "hub:edit.outdated",
  device_timeout: "hub:edit.timeout",
  hub_slicer: "hub:machine.errors.hubSlicer",
};

/** A failed save, in words: a connector that is offline, too old or silent says so. */
function Alert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const key = error instanceof ApiError && error.code ? ERRORS[error.code] : undefined;
  return (
    <p role="alert" className="text-bad">
      {t(key ?? "hub:errors.generic")}
    </p>
  );
}

/** Shown where a control needs the connector online (its port, start at login, Stop). */
function OfflineNote() {
  const { t } = useTranslation();
  return <p className="text-muted">{t("hub:edit.offlineNote")}</p>;
}

/** What the viewer may do on this machine's page (ADR-0021); the server checks the same rules. */
function useMay(d: Device) {
  const rights = useRights();
  const me = useMe();
  return {
    edit: (section: MachineSection) => !!rights && mayEditMachine(rights, me?.id, d, section),
    manage: useCan("hub.manage"),
    // The hub's slicer is picked, and a machine's install set up, in Integrations (ADR-0022).
    integrations: useCan("integrations.manage"),
  };
}

/**
 * One switch of the page: a `Switch` for who may change it, else its value as text (the ADR-0021
 * wireframe: a section the viewer can't edit shows values, not disabled controls).
 */
function Setting({
  edit,
  label,
  name,
  checked,
  busy,
  onChange,
}: {
  edit: boolean;
  label: string;
  /** The accessible name: the visible label with what it belongs to. */
  name: string;
  checked: boolean;
  busy?: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  return edit ? (
    <Switch
      label={label}
      aria-label={name}
      checked={checked}
      disabled={busy}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
  ) : (
    <span className="inline-flex min-h-9 items-center">
      {t(checked ? "hub:machine.valueOn" : "hub:machine.valueOff", { label })}
    </span>
  );
}

/** A code for another user, entered on the connector: its local page has no login to check. */
function ChangeUserDialogs({
  device: d,
  open,
  onClose,
}: {
  device: Device;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const users = useUsers(open);
  const { userCode } = useDeviceActions();
  const [made, setMade] = useState<PairingCode | null>(null);
  const close = () => {
    setMade(null);
    userCode.reset();
    onClose();
  };
  const people = (users.data ?? [])
    .filter((u) => !u.disabled && u.id !== d.userId)
    .map((u) => ({ value: u.id, label: u.displayName }));
  return (
    <>
      <FormDialog
        open={open && !made}
        title={t("hub:changeUser.title")}
        submitLabel={t("hub:pair.submit")}
        error={userCode.isError ? t("hub:errors.generic") : undefined}
        busy={userCode.isPending}
        onCancel={close}
        onSubmit={(f) =>
          userCode.mutate(
            { id: d.id, userId: String(f.get("userId") ?? "") },
            { onSuccess: setMade },
          )
        }
      >
        <p className="text-muted">{t("hub:changeUser.hint")}</p>
        <FormField label={t("hub:pair.user")}>
          {(p) => <Combobox {...p} name="userId" options={people} required />}
        </FormField>
      </FormDialog>
      <ConfirmDialog
        open={open && !!made}
        title={t("hub:changeUser.codeTitle", { name: d.name })}
        description={t("hub:changeUser.codeBody", {
          name: d.name,
          time: made ? formatTime(made.expiresAt) : "",
        })}
        confirmLabel={t("hub:code.done")}
        onCancel={close}
        onConfirm={close}
      >
        <p className="select-all text-center font-mono text-2xl font-semibold tracking-widest">
          {made?.code}
        </p>
      </ConfirmDialog>
    </>
  );
}

/** Name and user: hub.manage only (pairing and the machine's user stay there, ADR-0021). */
function Identity({ device: d, manage }: { device: Device; manage: boolean }) {
  const { t } = useTranslation();
  const { rename } = useDeviceActions();
  const [changing, setChanging] = useState(false);
  if (!manage)
    return (
      <Section title={t("hub:edit.identity")}>
        <p className="wrap-anywhere">{t("hub:machine.nameIs", { name: d.name })}</p>
        <p className="text-muted wrap-anywhere">{t("hub:devices.user", { name: d.userName })}</p>
      </Section>
    );
  return (
    <Section title={t("hub:edit.identity")}>
      {/* Outside the form: a dialog's own submit would bubble into it. */}
      <ChangeUserDialogs device={d} open={changing} onClose={() => setChanging(false)} />
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          rename.mutate({
            id: d.id,
            name: String(new FormData(e.currentTarget).get("name") ?? ""),
          });
        }}
      >
        <FormField label={t("hub:devices.name")}>
          {(p) => (
            <input
              {...p}
              name="name"
              required
              maxLength={100}
              defaultValue={d.name}
              className={inputClass}
            />
          )}
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted wrap-anywhere">{t("hub:devices.user", { name: d.userName })}</p>
          <Button onClick={() => setChanging(true)}>{t("hub:changeUser.action")}</Button>
        </div>
        <Alert error={rename.error} />
        <div>
          <Button type="submit" variant="primary" disabled={rename.isPending}>
            {t("common:actions.save")}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Software({ device: d, manage }: { device: Device; manage: boolean }) {
  const { t } = useTranslation();
  const { update } = useDeviceActions();
  const unknown = t("hub:devices.unknown");
  return (
    <Section title={t("hub:edit.software")}>
      <p className="text-muted wrap-anywhere">
        {t("hub:devices.details", {
          os: d.os ?? unknown,
          version: d.connectorVersion ?? unknown,
        })}
      </p>
      {!d.online && (
        <p className="text-muted">
          {d.lastSeenAt
            ? t("hub:devices.lastSeen", { when: formatDateTime(d.lastSeenAt) })
            : t("hub:devices.neverSeen")}
        </p>
      )}
      {d.outdated && (
        <>
          <p className="text-muted wrap-anywhere">
            {d.updateFailed?.reason === "download"
              ? t("hub:devices.failedDownload", {
                  version: d.updateFailed.version,
                  error: d.updateFailed.error ?? "",
                })
              : d.updateFailed?.reason === "rollback"
                ? t("hub:devices.failedRollback", { version: d.updateFailed.version })
                : t("hub:devices.outdatedHint")}
          </p>
          {/* An offline device can't get the event now. */}
          {manage &&
            (d.online ? (
              <>
                <Alert error={update.error} />
                <div>
                  <Button disabled={update.isPending} onClick={() => update.mutate(d.id)}>
                    {t("hub:devices.updateNow")}
                  </Button>
                </div>
              </>
            ) : (
              <OfflineNote />
            ))}
        </>
      )}
    </Section>
  );
}

function Connection({ device: d, edit }: { device: Device; edit: boolean }) {
  const { t } = useTranslation();
  const settings = useConnectorSettings(d.id, d.online);
  const { save } = useConnectorActions(d.id);
  const [notice, setNotice] = useState<ReactNode>(null);
  const current = settings.data;
  return (
    <Section title={t("hub:edit.connection")}>
      {!d.online ? (
        <OfflineNote />
      ) : settings.isError ? (
        <Alert error={settings.error} />
      ) : !current ? (
        <p className="text-muted">{t("hub:edit.loading")}</p>
      ) : !edit ? (
        <>
          <p>{t("hub:machine.portIs", { port: current.port })}</p>
          <p>
            {t(current.autostart ? "hub:machine.valueOn" : "hub:machine.valueOff", {
              label: t("hub:edit.autostart"),
            })}
          </p>
        </>
      ) : (
        <form
          // A new key per saved value: the fields start from what the connector has now.
          key={`${current.port}-${current.autostart}`}
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save.mutate(
              { port: Number(f.get("port")), autostart: f.get("autostart") === "on" },
              {
                onSuccess: (r) =>
                  setNotice(
                    r.restartRequired ? t("hub:edit.restartRequired", { port: r.port }) : null,
                  ),
              },
            );
          }}
        >
          <FormField label={t("hub:edit.port")} hint={t("hub:edit.portHint")}>
            {(p) => (
              <input
                {...p}
                name="port"
                type="number"
                required
                min={1024}
                max={65535}
                defaultValue={current.port}
                className={inputClass}
              />
            )}
          </FormField>
          <div>
            <Switch
              name="autostart"
              label={t("hub:edit.autostart")}
              defaultChecked={current.autostart}
            />
            <p className="text-muted">{t("hub:edit.autostartHint")}</p>
          </div>
          <Alert error={save.error} />
          {notice && <p role="status">{notice}</p>}
          <div>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {t("common:actions.save")}
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

/** One slicer on the machine: its version, and whether it is the hub's slicer (ADR-0022). */
function SlicerLine({ device: d, library }: { device: Device; library: string }) {
  const { t } = useTranslation();
  const name = useAdapterName()(library);
  const found = d.slicers.find((s) => s.id === library);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 wrap-anywhere">
      <span className="font-semibold">{name}</span>
      <span className="text-muted">
        {found?.version
          ? t("hub:machine.installedVersion", { version: found.version })
          : t("hub:machine.installed")}
      </span>
      {d.libraries[library]?.hubSlicer && <SourceBadge>{t("hub:machine.hubSlicer")}</SourceBadge>}
    </li>
  );
}

/** The slicers it reports and the hub's downloads: local or managed installs. */
const librariesOf = (d: Device) => [
  ...new Set([...d.slicers.map((s) => s.id), ...Object.keys(d.libraries)]),
];

/**
 * The slicers on the machine: the ones it reports and the hub's downloads. Use slicer as server
 * worker offers it in Integrations, where a slicer is installed or set up on it (ADR-0022).
 */
function Slicers({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const may = useMay(d);
  const { slicers } = useDeviceActions();
  const [confirm, setConfirm] = useState(false);
  const libraries = librariesOf(d);
  return (
    <Section title={t("hub:machine.slicers")}>
      {libraries.length > 0 && (
        <ul className="grid gap-2">
          {libraries.map((lib) => (
            <SlicerLine key={lib} device={d} library={lib} />
          ))}
        </ul>
      )}
      <Setting
        edit={may.manage}
        label={t("hub:machine.useAsWorker")}
        name={t("hub:machine.useAsWorker")}
        checked={d.useAsWorker}
        busy={slicers.isPending}
        // Off removes its installs in Integrations: asked first while it has one.
        onChange={(on) =>
          on || !d.sliceWorker ? slicers.mutate({ id: d.id, useAsWorker: on }) : setConfirm(true)
        }
      />
      {/* A slicer is installed on a worker machine from its card in Integrations. */}
      {d.useAsWorker && may.integrations && (
        <p>
          <Link to="/integrations" className={textLink}>
            {t("hub:machine.installInIntegrations")}
          </Link>
        </p>
      )}
      <Alert error={slicers.error} />
      <ConfirmDialog
        open={confirm}
        destructive
        title={t("hub:machine.stopWorkerTitle", { name: d.name })}
        description={t("hub:machine.stopWorkerBody")}
        confirmLabel={t("hub:machine.stopWorker")}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          slicers.mutate({ id: d.id, useAsWorker: false }, { onSettled: () => setConfirm(false) })
        }
      />
    </Section>
  );
}

/**
 * Slicers catalog, where the machine has a slicer: Receive from server and Share to server, as
 * Projects'. Off, it isn't that kind of source on Catalog settings → Sources.
 */
function SlicersCatalog({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const edit = useMay(d).edit("catalog");
  const { slicers } = useDeviceActions();
  if (!librariesOf(d).length) return null;
  return (
    <Section title={t("hub:machine.catalog")}>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Setting
          edit={edit}
          label={t("hub:machine.receiveCatalog")}
          name={t("hub:machine.receiveCatalogOf")}
          checked={d.receiveCatalog}
          busy={slicers.isPending}
          onChange={(on) => slicers.mutate({ id: d.id, receiveCatalog: on })}
        />
        <Setting
          edit={edit}
          label={t("hub:machine.shareCatalog")}
          name={t("hub:machine.shareCatalogOf")}
          checked={d.shareCatalog}
          busy={slicers.isPending}
          onChange={(on) => slicers.mutate({ id: d.id, shareCatalog: on })}
        />
      </div>
      <Alert error={slicers.error} />
      {(d.receiveCatalog || d.shareCatalog) && (
        <SyncSources
          types={["machinePresets"]}
          hash={`machine-${d.id}`}
          labels={{ catalog: t("hub:machine.catalogSources") }}
        />
      )}
    </Section>
  );
}

function Projects({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const may = useMay(d);
  const edit = may.edit("projects");
  const { projects } = useDeviceActions();
  const [confirm, setConfirm] = useState(false);
  // Its picks and shared folders are set on the Sources tab: the Projects sources button below.
  const line = "flex flex-wrap items-center gap-x-4 gap-y-1";
  return (
    <Section title={t("hub:machine.projects")}>
      <div className={line}>
        <Setting
          edit={edit}
          label={t("hub:machine.receiveProjects")}
          name={t("hub:machine.receiveProjects")}
          checked={d.receiveProjects}
          busy={projects.isPending}
          onChange={(on) =>
            on ? projects.mutate({ id: d.id, receiveProjects: true }) : setConfirm(true)
          }
        />
        {d.receiveProjects && (
          <span className="text-muted">
            {t("hub:machine.pickCount", { count: d.picks.length })}
          </span>
        )}
        {d.receiveProjects && d.sync && <SyncLine sync={d.sync} />}
      </div>
      <div className={line}>
        <Setting
          edit={edit}
          label={t("hub:machine.shareProjects")}
          name={t("hub:machine.shareProjects")}
          checked={d.shareProjects}
          busy={projects.isPending}
          onChange={(on) => projects.mutate({ id: d.id, shareProjects: on })}
        />
        {d.shareProjects && (
          <span className="text-muted">
            {t("hub:machine.folderCount", { count: d.sharedFolders?.length ?? 0 })}
          </span>
        )}
        {/* ponytail: shared folders have no sync report of their own; online with its list
                reported reads as up to date. A real state needs the connector to report its scans. */}
        {d.shareProjects && d.online && d.sharedFolders && (
          <span className="text-muted">{t("hub:machine.upToDate")}</span>
        )}
      </div>
      <Alert error={projects.error} />
      {(d.receiveProjects || d.shareProjects) && (
        <SyncSources
          types={["projects"]}
          hash={`machine-${d.id}`}
          labels={{ projects: t("hub:machine.projectSources") }}
        />
      )}
      <ConfirmDialog
        open={confirm}
        title={t("hub:machine.stopReceivingTitle", { name: d.name })}
        description={t("hub:machine.stopReceivingBody")}
        confirmLabel={t("hub:machine.stopReceiving")}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          projects.mutate(
            { id: d.id, receiveProjects: false },
            { onSettled: () => setConfirm(false) },
          )
        }
      />
    </Section>
  );
}

/**
 * Restart and Stop act on the connector (live); Revoke on the pairing (hub.manage). The buttons go
 * in the page header, the messages under it.
 */
function useActions(d: Device) {
  const { t } = useTranslation();
  const may = useMay(d);
  const navigate = useNavigate();
  const { restart, stop } = useConnectorActions(d.id);
  const { revoke } = useDeviceActions();
  const [dialog, setDialog] = useState<"stop" | "revoke" | null>(null);
  const connection = may.edit("connection");
  const buttons = (
    <>
      {connection && (
        <>
          <Button disabled={!d.online} busy={restart.isPending} onClick={() => restart.mutate()}>
            {t("hub:devices.restart")}
          </Button>
          <Button disabled={!d.online || stop.isPending} onClick={() => setDialog("stop")}>
            {t("hub:machine.stop")}
          </Button>
        </>
      )}
      {may.manage && (
        <Button variant="danger" onClick={() => setDialog("revoke")}>
          {t("hub:devices.revoke")}
        </Button>
      )}
    </>
  );
  const messages = (
    <>
      <Alert error={restart.error ?? stop.error} />
      {restart.isSuccess && (
        <p role="status" className="text-muted">
          {t("hub:edit.restarting")}
        </p>
      )}
      {stop.isSuccess && (
        <p role="status" className="text-muted">
          {t("hub:machine.stopped")}
        </p>
      )}
      <ConfirmDialog
        open={dialog === "stop"}
        title={t("hub:machine.stopTitle", { name: d.name })}
        description={t("hub:machine.stopBody")}
        confirmLabel={t("hub:machine.stop")}
        onCancel={() => setDialog(null)}
        onConfirm={() => stop.mutate(undefined, { onSettled: () => setDialog(null) })}
      />
      <ConfirmDialog
        open={dialog === "revoke"}
        destructive
        title={t("hub:devices.revokeTitle", { name: d.name })}
        description={revoke.isError ? t("hub:errors.generic") : t("hub:devices.revokeBody")}
        confirmLabel={t("hub:devices.revoke")}
        onCancel={() => {
          revoke.reset();
          setDialog(null);
        }}
        onConfirm={() => revoke.mutate(d.id, { onSuccess: () => navigate({ to: "/hub" }) })}
      />
    </>
  );
  return { buttons, messages };
}

/** The pill next to the name, and the actions top right. */
function Header({ device: d, backTo }: { device: Device; backTo: { to: "/hub" | "/" } }) {
  const { t } = useTranslation();
  const { buttons, messages } = useActions(d);
  return (
    <>
      <PageHeader
        title={d.name}
        badge={
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${d.online ? "bg-ok/15 text-ok" : "bg-border text-muted"}`}
          >
            {t(d.online ? "hub:devices.online" : "hub:devices.offline")}
          </span>
        }
        backTo={backTo}
        actions={buttons}
      />
      {messages}
    </>
  );
}

/** This browser runs on the machine (its connector answers `whoami`): a link to its local page. */
function LocalPage({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const here = useConnectorId([d.port], d.online).data === d.id;
  if (!here) return null;
  return (
    <p>
      <a href={`http://127.0.0.1:${d.port ?? CONNECTOR_PORT}/local`} className={textLink}>
        {t("hub:machine.localPage")}
      </a>
    </p>
  );
}

/**
 * A machine's page (ADR-0021): hub.manage, or the machine's own user, read-only or editing the
 * sections its `machine.*` switches allow. Live controls say so while it's offline.
 */
export function MachinePage() {
  const { t } = useTranslation();
  const { deviceId } = useParams({ strict: false }) as { deviceId: string };
  const devices = useDevices();
  const device = devices.data?.find((d) => d.id === deviceId);
  const rights = useRights();
  const me = useMe();
  const manage = useCan("hub.manage");
  const backTo = manage ? { to: "/hub" as const } : { to: "/" as const };
  return (
    <>
      {device ? (
        <Header device={device} backTo={backTo} />
      ) : (
        <PageHeader title={t("hub:machine.titleFallback")} backTo={backTo} />
      )}
      {devices.isError && (
        <p role="alert" className="text-bad">
          {t("hub:loadError")}
        </p>
      )}
      {devices.data && !device && <p className="text-muted">{t("hub:edit.notFound")}</p>}
      {device && (
        <div className="grid gap-4">
          {!device.online && <p className="text-muted">{t("hub:machine.offline")}</p>}
          <LocalPage device={device} />
          <div className={cardGrid}>
            <Identity key={device.name} device={device} manage={manage} />
            <Software device={device} manage={manage} />
            <Connection
              device={device}
              edit={!!rights && mayEditMachine(rights, me?.id, device, "connection")}
            />
            <Slicers device={device} />
            <SlicersCatalog device={device} />
            <Projects device={device} />
          </div>
        </div>
      )}
    </>
  );
}
