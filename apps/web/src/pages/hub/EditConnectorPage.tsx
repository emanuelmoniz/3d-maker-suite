import { type Device, type PairingCode, workerConfigSchema } from "@3d-maker-suite/core";
import { Link, useParams } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Section } from "../../components/Section.tsx";
import { Switch } from "../../components/Switch.tsx";
import { ApiError } from "../../lib/api.ts";
import { formatDateTime, formatTime } from "../../lib/format.ts";
import {
  useConnectorActions,
  useConnectorSettings,
  useDeviceActions,
  useDevices,
} from "../../lib/hub.ts";
import { useAdapterName, useIntegrations } from "../../lib/integrations.ts";
import { useUsers } from "../../lib/users.ts";
import { SyncLine } from "./SyncLine.tsx";

/** The message for a failed save: a connector that is offline or silent says so. */
function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) =>
    e instanceof ApiError && e.code === "device_offline"
      ? t("hub:edit.offline")
      : e instanceof ApiError && e.code === "device_outdated"
        ? t("hub:edit.outdated")
        : e instanceof ApiError && e.code === "device_timeout"
          ? t("hub:edit.timeout")
          : t("hub:errors.generic");
}

function Alert({ error }: { error: unknown }) {
  const text = useErrorText();
  return error ? (
    <p role="alert" className="text-bad">
      {text(error)}
    </p>
  ) : null;
}

/** Shown in a card that needs the connector online (its port, start at login, updating it). */
function OfflineNote() {
  const { t } = useTranslation();
  return <p className="text-muted">{t("hub:edit.offlineNote")}</p>;
}

/** A code for another user, entered on the connector: its status page has no login to check. */
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

function Identity({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const { rename } = useDeviceActions();
  const [changing, setChanging] = useState(false);
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

function Software({ device: d }: { device: Device }) {
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
          {d.online ? (
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
          )}
        </>
      )}
    </Section>
  );
}

function Connection({ device: d }: { device: Device }) {
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

function SyncCard({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const { syncMode, unselect } = useDeviceActions();
  return (
    <Section title={t("hub:edit.sync")}>
      {d.sync && <SyncLine sync={d.sync} />}
      <Alert error={syncMode.error ?? unselect.error} />
      <div className="grid gap-1">
        <span className="text-muted">{t("hub:devices.syncMode")}</span>
        <Combobox
          aria-label={t("hub:devices.syncModeOf", { name: d.name })}
          value={d.syncMode}
          disabled={syncMode.isPending}
          onChange={(v) =>
            (v === "all" || v === "selected") && syncMode.mutate({ id: d.id, syncMode: v })
          }
          options={[
            { value: "all", label: t("hub:devices.syncModes.all") },
            { value: "selected", label: t("hub:devices.syncModes.selected") },
          ]}
        />
      </div>
      {d.syncMode === "selected" &&
        (d.projects.length ? (
          <ul aria-label={t("hub:devices.projects")} className="flex flex-wrap gap-2">
            {d.projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-1 rounded-md border border-border pl-2"
              >
                <span className="wrap-anywhere">{p.name}</span>
                <Button
                  variant="ghost"
                  disabled={unselect.isPending}
                  aria-label={t("hub:devices.unselect", { name: p.name })}
                  onClick={() => unselect.mutate({ id: d.id, projectId: p.id })}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("hub:devices.noProjects")}</p>
        ))}
    </Section>
  );
}

function Slicing({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  // The slicers that slice on it for the hub: added as a location on their card.
  const workers = (useIntegrations().data ?? []).filter(
    (i) => i.kind === "worker" && workerConfigSchema.safeParse(i.config).data?.deviceId === d.id,
  );
  return (
    <Section title={t("hub:edit.slicing")}>
      {d.slicers.length ? (
        <div className="grid gap-1">
          <span className="text-muted">{t("hub:devices.slicers")}</span>
          <ul className="grid gap-1">
            {d.slicers.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-2">
                <span>
                  {s.version
                    ? t("hub:devices.slicer", { name: adapterName(s.id), version: s.version })
                    : adapterName(s.id)}
                </span>
                <span className="text-muted wrap-anywhere">{s.path}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted">{t("hub:devices.noSlicers")}</p>
      )}
      {workers.length ? (
        <ul className="grid gap-1">
          {workers.map((i) => (
            <li key={i.id}>
              <Link to="/integrations" hash={`integration-${i.id}`} className="underline">
                {t("hub:devices.usedBy", { name: adapterName(i.adapterId) })}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">
          <Trans
            t={t}
            i18nKey="hub:devices.notWorker"
            components={{ add: <Link to="/integrations" className="underline" /> }}
          />
        </p>
      )}
    </Section>
  );
}

// Written out so `pnpm i18n:check` sees the keys: [send][install].
const PRESETS_STATE = [
  ["hub:edit.presets.none", "hub:edit.presets.install"],
  ["hub:edit.presets.send", "hub:edit.presets.both"],
] as const;

/** Send presets and Install per slicer, read-only: they are edited in Presets settings → Sources (ADR-0020). */
function PresetsCard({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  // A desktop slicer's id is its library's.
  const libraries = [...new Set([...d.slicers.map((s) => s.id), ...Object.keys(d.presets)])];
  if (!libraries.length) return null;
  return (
    <Section title={t("hub:presets.slicerPresets")}>
      <ul className="grid gap-1">
        {libraries.map((lib) => {
          const s = d.presets[lib];
          return (
            <li key={lib} className="flex flex-wrap gap-x-2">
              <span>{adapterName(lib)}</span>
              <span className="text-muted">
                {t(PRESETS_STATE[s?.send ? 1 : 0][s?.install ? 1 : 0])}
              </span>
              <Link to="/presets/settings/sources" hash={`devices-${lib}`} className="underline">
                {t("hub:edit.presets.change")}
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Every setting of one connector (admin only). Cards that need it online say so when it isn't. */
export function EditConnectorPage() {
  const { t } = useTranslation();
  const { deviceId } = useParams({ strict: false }) as { deviceId: string };
  const devices = useDevices();
  const device = devices.data?.find((d) => d.id === deviceId);
  const title = device ? t("hub:edit.title", { name: device.name }) : t("hub:edit.titleFallback");

  return (
    <>
      <PageHeader title={title} backTo={{ to: "/hub" }} />
      {devices.isError && (
        <p role="alert" className="text-bad">
          {t("hub:loadError")}
        </p>
      )}
      {devices.data && !device && <p className="text-muted">{t("hub:edit.notFound")}</p>}
      {device && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <p className={device.online ? "text-ok lg:col-span-2" : "text-muted lg:col-span-2"}>
            {t(device.online ? "hub:devices.online" : "hub:devices.offline")}
          </p>
          <Identity key={device.name} device={device} />
          <Software device={device} />
          <Connection device={device} />
          <SyncCard device={device} />
          <Slicing device={device} />
          <PresetsCard device={device} />
        </div>
      )}
    </>
  );
}
