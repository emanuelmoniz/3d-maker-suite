import {
  type Device,
  type DeviceUserResult,
  deviceCanSlice,
  deviceSystem,
  isHeadless,
  type MachineSection,
  mayEditMachine,
  type PairingCode,
} from "@3d-maker-suite/core";
import { Link, type LinkProps, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { ItemMissing } from "../../components/ItemMissing.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { cardGrid, Section } from "../../components/Section.tsx";
import { useSettingsAccess } from "../../components/SettingsLink.tsx";
import { Switch } from "../../components/Switch.tsx";
import { SystemInfo, SystemUpdated } from "../../components/SystemInfo.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan, useMe, useRights } from "../../lib/auth.ts";
import { textLink } from "../../lib/cx.ts";
import { formatDateTime, formatTime } from "../../lib/format.ts";
import {
  useConnectorActions,
  useConnectorSettings,
  useDeviceActions,
  useDeviceSystem,
  useDevices,
} from "../../lib/hub.ts";
import {
  deviceOf,
  isNetworkSource,
  libraryOf,
  useAdapterName,
  useAdapters,
  useIntegrations,
} from "../../lib/integrations.ts";
import { DOCKER_UPDATE } from "../../lib/pairCommands.ts";
import { usePrinters } from "../../lib/printers.ts";
import { CONNECTOR_PORT, useConnectorId } from "../../lib/projects.ts";
import { useUsers } from "../../lib/users.ts";
import { SourceBadge } from "../settings/Sources.tsx";
import { CommandBlock } from "./CommandBlock.tsx";
import { SyncLine } from "./SyncLine.tsx";

// Written out so `pnpm i18n:check` sees the keys.
const ERRORS: Record<string, string> = {
  device_offline: "hub:edit.offline",
  device_outdated: "hub:edit.outdated",
  device_timeout: "hub:edit.timeout",
  hub_slicer: "hub:machine.errors.hubSlicer",
  hub_off: "hub:machine.errors.hubOff",
  slicing_unsupported: "hub:machine.errors.slicingUnsupported",
};

// Literal keys so `pnpm i18n:check` sees them.
const INSTALLS = {
  bundle: "hub:machine.install.bundle",
  headless: "hub:machine.install.headless",
  docker: "hub:machine.install.docker",
} as const;

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
  onChanged,
}: {
  device: Device;
  open: boolean;
  onClose: () => void;
  /** A headless connector's user changed at once. */
  onChanged: (result: DeviceUserResult) => void;
}) {
  const { t } = useTranslation();
  const users = useUsers(open);
  const { userCode, setUser } = useDeviceActions();
  const [made, setMade] = useState<PairingCode | null>(null);
  const close = () => {
    setMade(null);
    userCode.reset();
    setUser.reset();
    onClose();
  };
  const people = (users.data ?? [])
    .filter((u) => !u.disabled && u.id !== d.userId)
    .map((u) => ({ value: u.id, label: u.displayName }));
  // No screen at the machine to type a code at: the admin's choice applies at once (ADR-0024).
  if (isHeadless(d.install))
    return (
      <FormDialog
        open={open}
        title={t("hub:changeUser.title")}
        submitLabel={t("hub:changeUser.submitNow")}
        error={setUser.isError ? t("hub:errors.generic") : undefined}
        busy={setUser.isPending}
        onCancel={close}
        onSubmit={(f) =>
          setUser.mutate(
            {
              id: d.id,
              userId: String(f.get("userId") ?? ""),
              projects: f.get("projects") === "stay" ? "stay" : "move",
            },
            {
              onSuccess: (r) => {
                onChanged(r);
                close();
              },
            },
          )
        }
      >
        <p className="text-muted">{t("hub:changeUser.hintHeadless")}</p>
        <FormField label={t("hub:pair.user")}>
          {(p) => <Combobox {...p} name="userId" options={people} required />}
        </FormField>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 font-medium">{t("hub:changeUser.projects")}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="projects" value="move" defaultChecked />
            {t("hub:changeUser.move")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="projects" value="stay" />
            {t("hub:changeUser.stay")}
          </label>
        </fieldset>
      </FormDialog>
    );
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
        <div className="mt-3">
          <CopyButton value={made?.code ?? ""} label={t("hub:code.copy")} />
        </div>
      </ConfirmDialog>
    </>
  );
}

/** Name and user: hub.manage only (pairing and the machine's user stay there, ADR-0021). */
function Identity({ device: d, manage }: { device: Device; manage: boolean }) {
  const { t } = useTranslation();
  const { rename } = useDeviceActions();
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState<DeviceUserResult | null>(null);
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
      <ChangeUserDialogs
        device={d}
        open={changing}
        onClose={() => setChanging(false)}
        onChanged={setChanged}
      />
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
        {changed && (
          <p role="status" className="text-muted wrap-anywhere">
            {t("hub:changeUser.done", { name: changed.userName, count: changed.moved })}
          </p>
        )}
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

/**
 * Its CPU, memory, disks and addresses, as the connector last reported them (every 30 s while
 * online). Offline, only when it was last seen: never numbers that stopped being true.
 */
function System({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const q = useDeviceSystem(d.id, d.online);
  const report = d.online ? q.data?.system : undefined;
  return (
    <Section title={t("hub:system.title")} action={report && <SystemUpdated at={report.at} />}>
      {!d.online ? (
        <p className="text-muted">
          {d.lastSeenAt
            ? t("hub:system.offline", { when: formatDateTime(d.lastSeenAt) })
            : t("hub:devices.neverSeen")}
        </p>
      ) : q.isError ? (
        <Alert error={q.error} />
      ) : report ? (
        <SystemInfo
          system={report}
          addressNote={
            q.data?.seenFrom ? t("hub:system.seenFrom", { address: q.data.seenFrom }) : undefined
          }
        />
      ) : (
        <p className="text-muted">
          {q.isPending ? t("hub:system.loading") : t("hub:system.waiting")}
        </p>
      )}
    </Section>
  );
}

function Software({ device: d, manage }: { device: Device; manage: boolean }) {
  const { t } = useTranslation();
  const { update } = useDeviceActions();
  const unknown = t("hub:devices.unknown");
  const arch = deviceSystem(d.os)?.arch;
  // A container can't replace its own image (ADR-0009): it shows the command, not an Update now.
  const docker = d.install === "docker";
  return (
    <Section title={t("hub:edit.software")}>
      <p className="text-muted wrap-anywhere">
        {t("hub:devices.details", {
          os: d.os ?? unknown,
          version: d.connectorVersion ?? unknown,
        })}
      </p>
      {d.install && (
        <p className="text-muted wrap-anywhere">
          {t("hub:machine.installedAs", { kind: t(INSTALLS[d.install]) })}
        </p>
      )}
      {arch && <p className="text-muted">{t("hub:machine.architecture", { arch })}</p>}
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
                : docker
                  ? t("hub:machine.dockerUpdate")
                  : t("hub:devices.outdatedHint")}
          </p>
          {docker && (
            <CommandBlock
              name={t("hub:machine.copyUpdate")}
              text={DOCKER_UPDATE}
              copyLabel={t("hub:machine.copyUpdate")}
            />
          )}
          {/* An offline device can't get the event now. */}
          {manage &&
            !docker &&
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
 * Per slicer type that installs on a machine: Set up here (Add integration with this machine
 * preselected), or its card once it is set up here (6.1.0 Step 9).
 */
function SlicerLinks({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const types = (useAdapters().data ?? []).flatMap((a) =>
    a.kind === "worker" && a.libraryId ? [a.libraryId] : [],
  );
  const rows = useIntegrations().data ?? [];
  const here = (lib: string) => rows.some((i) => libraryOf(i) === lib && deviceOf(i) === d.id);
  if (!types.length) return null;
  return (
    <ul className="grid gap-1">
      {types.map((lib) => (
        <li key={lib}>
          {here(lib) ? (
            <Link
              to="/settings/integrations"
              search={{ via: d.id }}
              hash={lib}
              className={textLink}
            >
              {t("hub:machine.slicerCard", { name: adapterName(lib) })}
            </Link>
          ) : (
            <Link to="/integrations/new" search={{ product: lib, via: d.id }} className={textLink}>
              {t("hub:machine.setUpSlicer", { name: adapterName(lib) })}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

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
  const canSlice = deviceCanSlice(d.os);
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
        // Linux on ARM can't slice (ADR-0024): it can't be turned on, a stale "on" can still go off.
        busy={slicers.isPending || (!canSlice && !d.useAsWorker)}
        // Off removes its installs in Integrations: asked first while it has one.
        onChange={(on) =>
          on || !d.sliceWorker ? slicers.mutate({ id: d.id, useAsWorker: on }) : setConfirm(true)
        }
      />
      {!canSlice && may.manage && <p className="text-muted">{t("hub:machine.cantSlice")}</p>}
      {/* A slicer is set up on a worker machine from Add integration, then managed on its card. */}
      {d.useAsWorker && may.integrations && <SlicerLinks device={d} />}
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

// A switch and what belongs to it, on one line.
const SWITCH_LINE = "flex flex-wrap items-center gap-x-4 gap-y-1";

/**
 * Where what a switch turns on is set up, opening this machine's card: Send goes to the module's
 * Sources tab, Get to its Consumers tab. Only for who may open that tab.
 */
function SwitchTabLink({
  module,
  tab,
  device: d,
  children,
}: {
  module: "catalog" | "projects";
  tab: "sources" | "consumers";
  device: Device;
  children: string;
}) {
  const { sources } = useSettingsAccess(module);
  if (!sources) return null;
  return (
    <Link
      to={`/${module}/settings/${tab}` as LinkProps["to"]}
      hash={`${tab === "sources" ? "machine" : "receive"}-${d.id}`}
      className="inline-flex h-9 items-center whitespace-nowrap rounded-md border border-border px-3 font-medium hover:bg-surface-2"
    >
      {children}
    </Link>
  );
}

/**
 * Slicers catalog, where the machine has a slicer: Get catalog from server and Send catalog to
 * server, as Projects'. Off, it isn't listed that way on Catalog settings → Consumers or Sources.
 */
function SlicersCatalog({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const edit = useMay(d).edit("catalog");
  const { slicers } = useDeviceActions();
  if (!librariesOf(d).length) return null;
  return (
    <Section title={t("hub:machine.catalog")}>
      <div className={SWITCH_LINE}>
        <Setting
          edit={edit}
          label={t("hub:machine.receiveCatalog")}
          name={t("hub:machine.receiveCatalog")}
          checked={d.receiveCatalog}
          busy={slicers.isPending}
          onChange={(on) => slicers.mutate({ id: d.id, receiveCatalog: on })}
        />
        {d.receiveCatalog && (
          <SwitchTabLink module="catalog" tab="consumers" device={d}>
            {t("hub:machine.catalogConsumers")}
          </SwitchTabLink>
        )}
      </div>
      <div className={SWITCH_LINE}>
        <Setting
          edit={edit}
          label={t("hub:machine.shareCatalog")}
          name={t("hub:machine.shareCatalog")}
          checked={d.shareCatalog}
          busy={slicers.isPending}
          onChange={(on) => slicers.mutate({ id: d.id, shareCatalog: on })}
        />
        {d.shareCatalog && (
          <SwitchTabLink module="catalog" tab="sources" device={d}>
            {t("hub:machine.catalogSources")}
          </SwitchTabLink>
        )}
      </div>
      <Alert error={slicers.error} />
    </Section>
  );
}

/**
 * Folders whose deletes the mass delete guard held (a sync folder that went missing): delete them
 * on the hub too, or restore them, from here, so a machine with no screen can answer (ADR-0024).
 * The connector does it live, so it needs to be online.
 */
function HeldFolders({ device: d, edit }: { device: Device; edit: boolean }) {
  const { t } = useTranslation();
  const { held } = useDeviceActions();
  const [asking, setAsking] = useState<{ rootId: string; name: string } | null>(null);
  const rows = d.sync?.state === "paused" ? d.sync.held : [];
  if (!rows.length) return null;
  const answer = (rootId: string, action: "confirm" | "restore") =>
    held.mutate({ id: d.id, rootId, action }, { onSettled: () => setAsking(null) });
  return (
    <div className="grid gap-2">
      {rows.map((r) => (
        <div key={r.rootId} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="wrap-anywhere">
            {t("hub:machine.held.line", { name: r.name, count: r.files })}
          </span>
          {edit && (
            <>
              <Button
                disabled={!d.online || held.isPending}
                aria-label={t("hub:machine.held.confirmNamed", { name: r.name })}
                onClick={() => setAsking({ rootId: r.rootId, name: r.name })}
              >
                {t("hub:machine.held.confirm")}
              </Button>
              <Button
                disabled={!d.online || held.isPending}
                aria-label={t("hub:machine.held.restoreNamed", { name: r.name })}
                onClick={() => answer(r.rootId, "restore")}
              >
                {t("hub:machine.held.restore")}
              </Button>
            </>
          )}
        </div>
      ))}
      {edit && !d.online && <OfflineNote />}
      {held.isSuccess && held.variables?.action === "restore" && (
        <p role="status" className="text-muted">
          {t("hub:machine.held.restoring")}
        </p>
      )}
      <Alert error={held.error} />
      <ConfirmDialog
        open={!!asking}
        destructive
        title={t("hub:machine.held.confirmTitle", { name: asking?.name ?? "" })}
        description={t("hub:machine.held.confirmBody")}
        confirmLabel={t("hub:machine.held.confirm")}
        busy={held.isPending}
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && answer(asking.rootId, "confirm")}
      />
    </div>
  );
}

function Projects({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const may = useMay(d);
  const edit = may.edit("projects");
  const { projects } = useDeviceActions();
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title={t("hub:machine.projects")}>
      <div className={SWITCH_LINE}>
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
          <SwitchTabLink module="projects" tab="consumers" device={d}>
            {t("hub:machine.projectConsumers")}
          </SwitchTabLink>
        )}
        {d.receiveProjects && (
          <span className="text-muted">
            {t("hub:machine.pickCount", { count: d.picks.length })}
          </span>
        )}
        {d.receiveProjects && d.sync && <SyncLine sync={d.sync} />}
      </div>
      {d.receiveProjects && <HeldFolders device={d} edit={edit} />}
      <div className={SWITCH_LINE}>
        <Setting
          edit={edit}
          label={t("hub:machine.shareProjects")}
          name={t("hub:machine.shareProjects")}
          checked={d.shareProjects}
          busy={projects.isPending}
          onChange={(on) => projects.mutate({ id: d.id, shareProjects: on })}
        />
        {d.shareProjects && (
          <SwitchTabLink module="projects" tab="sources" device={d}>
            {t("hub:machine.projectSources")}
          </SwitchTabLink>
        )}
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
 * Printers, or spool libraries, on this machine's network that it reaches for the hub (ADR-0015,
 * LAN reach): off, the machine isn't offered in Integrations' Reached from and the hub doesn't
 * relay for it. Its connector reads them, never commands a printer, and writes a spool library only
 * what prints used. The sources are set up in Integrations; this lists what goes through here.
 */
function Reach({ device: d, kind }: { device: Device; kind: "printers" | "spoolLibraries" }) {
  const { t } = useTranslation();
  const may = useMay(d);
  const { slicers } = useDeviceActions();
  const adapters = useAdapters();
  const integrations = useIntegrations(may.integrations);
  const adapterName = useAdapterName();
  const [confirm, setConfirm] = useState(false);
  const printers = kind === "printers";
  // A printer is named by its own name; one not imported yet, or a spool library, by its adapter.
  const known = usePrinters({ archived: "all" }).data?.items ?? [];
  const on = printers ? d.reachPrinters : d.reachSpoolLibraries;
  const set = (value: boolean) =>
    slicers.mutate(
      printers ? { id: d.id, reachPrinters: value } : { id: d.id, reachSpoolLibraries: value },
      { onSettled: () => setConfirm(false) },
    );
  const mine = new Set(
    adapters.data
      ?.filter((a) => isNetworkSource(a) && a.capabilities.includes("printerStatus") === printers)
      .map((a) => a.id),
  );
  const here = (integrations.data ?? []).filter(
    (i) => i.deviceId === d.id && mine.has(i.adapterId),
  );
  const label = (i: (typeof here)[number]) => {
    const host = (i.config as { host?: unknown } | undefined)?.host;
    // A name you gave it (Spoolman), else its adapter's.
    const name = (!printers && i.account?.name) || adapterName(i.adapterId);
    const printer = printers ? known.find((p) => p.integrationId === i.id)?.name : undefined;
    const text =
      printer ??
      (typeof host === "string" && host ? t("hub:machine.sourceAt", { name, host }) : name);
    return i.enabled ? text : t("hub:machine.sourcePaused", { label: text });
  };
  const name = t(
    printers ? "hub:machine.reachPrintersName" : "hub:machine.reachSpoolLibrariesName",
  );
  return (
    <Section title={t(printers ? "hub:machine.printers" : "hub:machine.spoolLibraries")}>
      <p className="text-muted">
        {t(printers ? "hub:machine.reachPrintersHint" : "hub:machine.reachSpoolLibrariesHint")}
      </p>
      <Setting
        edit={may.manage}
        label={t(printers ? "hub:machine.reachPrinters" : "hub:machine.reachSpoolLibraries")}
        name={name}
        checked={on}
        busy={slicers.isPending}
        // Off pauses what goes through it: asked first while something does.
        onChange={(value) =>
          value || !here.some((i) => i.enabled) ? set(value) : setConfirm(true)
        }
      />
      {may.integrations &&
        (here.length ? (
          <ul className="grid gap-1">
            {here.map((i) => (
              <li key={i.id} className="wrap-anywhere">
                {label(i)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            {t(printers ? "hub:machine.noPrinters" : "hub:machine.noSpoolLibraries")}
          </p>
        ))}
      {on && may.integrations && (
        <p>
          {here.length ? (
            <Link to="/settings/integrations" search={{ via: d.id }} className={textLink}>
              {t("hub:machine.openInIntegrations")}
            </Link>
          ) : (
            <Link to="/integrations/new" search={{ via: d.id }} className={textLink}>
              {t("hub:machine.setUpInIntegrations")}
            </Link>
          )}
        </p>
      )}
      <Alert error={slicers.error} />
      <ConfirmDialog
        open={confirm}
        destructive
        title={t(
          printers
            ? "hub:machine.stopReachPrintersTitle"
            : "hub:machine.stopReachSpoolLibrariesTitle",
          { name: d.name },
        )}
        description={t("hub:machine.stopReachBody")}
        confirmLabel={t("hub:machine.stopReach")}
        onCancel={() => setConfirm(false)}
        onConfirm={() => set(false)}
      >
        <ul className="grid gap-1">
          {here
            .filter((i) => i.enabled)
            .map((i) => (
              <li key={i.id} className="wrap-anywhere">
                {label(i)}
              </li>
            ))}
        </ul>
      </ConfirmDialog>
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
        onConfirm={() =>
          revoke.mutate(d.id, { onSuccess: () => navigate({ to: "/settings/hub" }) })
        }
      />
    </>
  );
  return { buttons, messages };
}

/** The pill next to the name, and the actions top right. */
function Header({ device: d, backTo }: { device: Device; backTo: { to: "/settings/hub" | "/" } }) {
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
  // The hub is off (the server's 404 `hub_off`).
  const hubOff = devices.error instanceof ApiError && devices.error.status === 404;
  const rights = useRights();
  const me = useMe();
  const manage = useCan("hub.manage");
  const backTo = manage ? { to: "/settings/hub" as const } : { to: "/" as const };
  return (
    <>
      {device ? (
        <Header device={device} backTo={backTo} />
      ) : (
        <PageHeader title={t("hub:machine.titleFallback")} backTo={backTo} />
      )}
      {devices.isError && !hubOff && (
        <p role="alert" className="text-bad">
          {t("hub:loadError")}
        </p>
      )}
      {/* Someone else's machine is left out of the list, and with the hub off there is none: it
          looks like a missing one. */}
      {((devices.data && !device) || hubOff) && <ItemMissing />}
      {device && (
        <div className="grid gap-4">
          {!device.online && <p className="text-muted">{t("hub:machine.offline")}</p>}
          <LocalPage device={device} />
          <div className={cardGrid}>
            <Identity key={device.name} device={device} manage={manage} />
            <Software device={device} manage={manage} />
            <System device={device} />
            <Connection
              device={device}
              edit={!!rights && mayEditMachine(rights, me?.id, device, "connection")}
            />
            <Slicers device={device} />
            <SlicersCatalog device={device} />
            <Projects device={device} />
            <Reach device={device} kind="printers" />
            <Reach device={device} kind="spoolLibraries" />
          </div>
        </div>
      )}
    </>
  );
}
