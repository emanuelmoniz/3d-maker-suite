import type { Device } from "@3d-maker-suite/core";
import { MonitorSmartphone, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Section } from "../../components/Section.tsx";
import { formatDateTime, formatTime } from "../../lib/format.ts";
import { useDeviceActions, useDevices } from "../../lib/hub.ts";
import { useAdapterName } from "../../lib/integrations.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";
import { useUsers } from "../../lib/users.ts";

/** The device's last sync report of the hub roots, as one line. */
function SyncLine({ sync }: { sync: NonNullable<Device["sync"]> }) {
  const { t } = useTranslation();
  if (sync.state === "paused")
    return (
      <p className="text-warn wrap-anywhere">
        {t("hub:devices.sync.paused", {
          count: sync.held.reduce((n, h) => n + h.files, 0),
          roots: sync.held.map((h) => h.name).join(", "),
        })}
      </p>
    );
  if (sync.state === "error")
    return (
      <p className="text-bad wrap-anywhere">
        {t("hub:devices.sync.error", { error: sync.error ?? "" })}
      </p>
    );
  return (
    <p className="text-muted">
      {sync.state === "syncing"
        ? t("hub:devices.sync.syncing", { count: sync.pending })
        : t("hub:devices.sync.idle", { count: sync.files })}
    </p>
  );
}

/** What the device syncs, and the slicers Open uses there. */
function DeviceSync({ device: d }: { device: Device }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const { syncMode, unselect } = useDeviceActions();
  return (
    <div className="mt-2 grid gap-2">
      {(syncMode.isError || unselect.isError) && (
        <p role="alert" className="text-bad">
          {t("hub:errors.generic")}
        </p>
      )}
      <div className="grid gap-1 sm:max-w-xs">
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
      <p className="text-muted wrap-anywhere">
        {d.slicers.length
          ? t("hub:devices.slicers", {
              list: d.slicers
                .map((s) => (s.version ? `${adapterName(s.id)} ${s.version}` : adapterName(s.id)))
                .join(", "),
            })
          : t("hub:devices.noSlicers")}
      </p>
    </div>
  );
}

const LOCK_HINTS = {
  off: "hub:settings.lockHints.off",
  on: "hub:settings.lockHints.on",
  strict: "hub:settings.lockHints.strict",
} as const;

/** Hub settings that belong to the sync: the mass delete guard and check-out locks. */
function SyncSettings() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const save = useSavePreferences();
  const values = prefs.data?.values;
  if (!values) return null;
  const { hubDeleteGuard: v, hubLocks: locks, hubLockIdleMin: idle } = values;
  return (
    <Section title={t("hub:settings.title")} help="docs/hub.md">
      {save.isError && (
        <p role="alert" className="mb-4 text-bad">
          {t("hub:errors.generic")}
        </p>
      )}
      <div className="grid gap-4 sm:max-w-md">
        <FormField label={t("hub:settings.deleteGuard")} hint={t("hub:settings.deleteGuardHint")}>
          {(p) => (
            <input
              key={v}
              {...p}
              className={inputClass}
              type="number"
              min={1}
              max={10_000}
              step={1}
              defaultValue={v}
              onBlur={(e) => {
                const n = e.target.valueAsNumber;
                if (e.target.checkValidity() && Number.isFinite(n) && n !== v)
                  save.mutate({ hubDeleteGuard: n });
              }}
            />
          )}
        </FormField>
        <FormField label={t("hub:settings.locks")} hint={t(LOCK_HINTS[locks])}>
          {(p) => (
            <Combobox
              {...p}
              value={locks}
              disabled={save.isPending}
              onChange={(x) =>
                (x === "off" || x === "on" || x === "strict") && save.mutate({ hubLocks: x })
              }
              options={[
                { value: "off", label: t("hub:settings.lockModes.off") },
                { value: "on", label: t("hub:settings.lockModes.on") },
                { value: "strict", label: t("hub:settings.lockModes.strict") },
              ]}
            />
          )}
        </FormField>
        {locks !== "off" && (
          <FormField label={t("hub:settings.lockIdle")} hint={t("hub:settings.lockIdleHint")}>
            {(p) => (
              <input
                key={idle}
                {...p}
                className={inputClass}
                type="number"
                min={5}
                max={1440}
                step={1}
                defaultValue={idle}
                onBlur={(e) => {
                  const n = e.target.valueAsNumber;
                  if (e.target.checkValidity() && Number.isFinite(n) && n !== idle)
                    save.mutate({ hubLockIdleMin: n });
                }}
              />
            )}
          </FormField>
        )}
      </div>
    </Section>
  );
}

type Dialog =
  | { kind: "pair" }
  | { kind: "code"; code: string; expiresAt: string }
  | { kind: "rename" | "revoke"; device: Device };

/** Hub management (ADR-0014): admin only, in the menu while the hub is on. */
export function HubPage() {
  const { t } = useTranslation();
  const devices = useDevices();
  const users = useUsers(true);
  const { pairingCode, rename, revoke, update } = useDeviceActions();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const close = () => {
    setDialog(null);
    for (const m of [pairingCode, rename, revoke]) m.reset();
  };
  const error = [pairingCode, rename, revoke].some((m) => m.isError)
    ? t("hub:errors.generic")
    : undefined;
  const people = (users.data ?? [])
    .filter((u) => !u.disabled)
    .map((u) => ({ value: u.id, label: u.displayName }));

  return (
    <>
      <PageHeader
        title={t("hub:title")}
        description={t("hub:description")}
        actions={
          <Button variant="primary" onClick={() => setDialog({ kind: "pair" })}>
            {t("hub:pair.action")}
          </Button>
        }
      />
      {update.isError && (
        <p role="alert" className="text-bad">
          {t("hub:errors.generic")}
        </p>
      )}
      {devices.isError && (
        <p role="alert" className="text-bad">
          {t("hub:loadError")}
        </p>
      )}
      {devices.data &&
        (devices.data.length ? (
          <ul aria-label={t("hub:devices.label")} className="grid gap-2">
            {devices.data.map((d) => (
              <li
                key={d.id}
                className="grid gap-3 rounded-md border border-border p-3 lg:grid-cols-[1fr_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <p className="font-medium wrap-anywhere">
                    {d.name}
                    <span className={d.online ? "ml-2 text-ok" : "ml-2 text-muted"}>
                      {t(d.online ? "hub:devices.online" : "hub:devices.offline")}
                    </span>
                    {d.outdated && (
                      <span className={d.updateFailed ? "ml-2 text-bad" : "ml-2 text-warn"}>
                        {t(d.updateFailed ? "hub:devices.updateFailed" : "hub:devices.outdated")}
                      </span>
                    )}
                  </p>
                  <p className="text-muted wrap-anywhere">
                    {t("hub:devices.details", {
                      user: d.userName,
                      os: d.os ?? t("hub:devices.unknown"),
                      version: d.connectorVersion ?? t("hub:devices.unknown"),
                    })}
                  </p>
                  {d.outdated && (
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
                  )}
                  {d.sync && <SyncLine sync={d.sync} />}
                  <DeviceSync device={d} />
                  {!d.online && (
                    <p className="text-muted">
                      {d.lastSeenAt
                        ? t("hub:devices.lastSeen", { when: formatDateTime(d.lastSeenAt) })
                        : t("hub:devices.neverSeen")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {d.outdated && (
                    // An offline device can't get the event now.
                    <Button
                      disabled={!d.online || update.isPending}
                      onClick={() => update.mutate(d.id)}
                    >
                      {t("hub:devices.updateNow")}
                    </Button>
                  )}
                  <Button onClick={() => setDialog({ kind: "rename", device: d })}>
                    {t("hub:devices.rename")}
                  </Button>
                  <Button variant="danger" onClick={() => setDialog({ kind: "revoke", device: d })}>
                    {t("hub:devices.revoke")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={MonitorSmartphone}
            title={t("hub:devices.emptyTitle")}
            description={t("hub:devices.emptyBody")}
          />
        ))}
      <div className="mt-6">
        <SyncSettings />
      </div>

      <FormDialog
        open={dialog?.kind === "pair"}
        title={t("hub:pair.title")}
        submitLabel={t("hub:pair.submit")}
        error={error}
        busy={pairingCode.isPending}
        onCancel={close}
        onSubmit={(f) =>
          pairingCode.mutate(String(f.get("userId") ?? ""), {
            onSuccess: (c) => setDialog({ kind: "code", ...c }),
          })
        }
      >
        <p className="text-muted">{t("hub:pair.hint")}</p>
        <FormField label={t("hub:pair.user")}>
          {(p) => <Combobox {...p} name="userId" options={people} required />}
        </FormField>
      </FormDialog>

      <ConfirmDialog
        open={dialog?.kind === "code"}
        title={t("hub:code.title")}
        description={t("hub:code.body", {
          time: dialog?.kind === "code" ? formatTime(dialog.expiresAt) : "",
        })}
        confirmLabel={t("hub:code.done")}
        onCancel={close}
        onConfirm={close}
      >
        <p className="select-all text-center font-mono text-2xl font-semibold tracking-widest">
          {dialog?.kind === "code" && dialog.code}
        </p>
      </ConfirmDialog>

      <FormDialog
        open={dialog?.kind === "rename"}
        title={t("hub:devices.renameTitle")}
        error={error}
        busy={rename.isPending}
        onCancel={close}
        onSubmit={(f) =>
          dialog?.kind === "rename" &&
          rename.mutate(
            { id: dialog.device.id, name: String(f.get("name") ?? "") },
            { onSuccess: close },
          )
        }
      >
        <FormField label={t("hub:devices.name")}>
          {(p) => (
            <input
              {...p}
              name="name"
              required
              maxLength={100}
              defaultValue={dialog?.kind === "rename" ? dialog.device.name : ""}
              className={inputClass}
            />
          )}
        </FormField>
      </FormDialog>

      <ConfirmDialog
        open={dialog?.kind === "revoke"}
        destructive
        title={t("hub:devices.revokeTitle", {
          name: dialog?.kind === "revoke" ? dialog.device.name : "",
        })}
        description={error ?? t("hub:devices.revokeBody")}
        confirmLabel={t("hub:devices.revoke")}
        onCancel={close}
        onConfirm={() =>
          dialog?.kind === "revoke" && revoke.mutate(dialog.device.id, { onSuccess: close })
        }
      />
    </>
  );
}
