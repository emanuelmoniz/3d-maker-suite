import type { Device } from "@3d-maker-suite/core";
import { useParams } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Section } from "../../components/Section.tsx";
import { Switch } from "../../components/Switch.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan } from "../../lib/auth.ts";
import { formatDateTime } from "../../lib/format.ts";
import {
  useConnectorActions,
  useConnectorSettings,
  useDeviceActions,
  useDevices,
} from "../../lib/hub.ts";
import { useAdapterName } from "../../lib/integrations.ts";
import { usePresetDevices } from "../../lib/presets.ts";
import { InstallStatus } from "./PresetsPage.tsx";
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

function Identity({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const { rename } = useDeviceActions();
  return (
    <Section title={t("hub:edit.identity")}>
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
        <p className="text-muted wrap-anywhere">{t("hub:devices.user", { name: d.userName })}</p>
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
  const { sliceWorker } = useDeviceActions();
  return (
    <Section title={t("hub:edit.slicing")}>
      <Alert error={sliceWorker.error} />
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
      <div>
        <Switch
          label={t("hub:devices.sliceWorker")}
          checked={d.sliceWorker}
          disabled={sliceWorker.isPending}
          onChange={(e) => sliceWorker.mutate({ id: d.id, sliceWorker: e.target.checked })}
        />
        <p className="text-muted">{t("hub:devices.sliceWorkerHint")}</p>
      </div>
    </Section>
  );
}

/** Install hub presets on this device, for those who may see it (presets.manage). */
function PresetsCard({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const allowed = useCan("presets.manage");
  const status = usePresetDevices(allowed).data?.find((p) => p.id === d.id);
  if (!status?.installPresets) return null;
  return (
    <Section title={t("hub:presets.slicerPresets")}>
      {status.presetInstall ? (
        <InstallStatus status={status.presetInstall} />
      ) : (
        <p className="text-muted">{t("hub:edit.loading")}</p>
      )}
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
