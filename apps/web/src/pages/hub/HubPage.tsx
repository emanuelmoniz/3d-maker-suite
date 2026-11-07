import type { Device } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { formatDateTime, formatTime } from "../../lib/format.ts";
import { useConnectorActions, useDeviceActions, useDevices } from "../../lib/hub.ts";
import { useUsers } from "../../lib/users.ts";

type Dialog =
  | { kind: "pair" }
  | { kind: "code"; code: string; expiresAt: string }
  | { kind: "revoke"; device: Device };

/** One device in the list: where it stands, and the two actions that act on the connector itself. */
function DeviceCard({ device: d, onRevoke }: { device: Device; onRevoke: () => void }) {
  const { t } = useTranslation();
  const { restart } = useConnectorActions(d.id);
  return (
    <li className="grid gap-3 rounded-md border border-border p-3 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="min-w-0">
        <p className="font-medium wrap-anywhere">
          <Link to="/hub/devices/$deviceId" params={{ deviceId: d.id }} className="hover:underline">
            {d.name}
          </Link>
          <span className={d.online ? "ml-2 text-ok" : "ml-2 text-muted"}>
            {t(d.online ? "hub:devices.online" : "hub:devices.offline")}
          </span>
          {d.outdated && (
            <span className={d.updateFailed ? "ml-2 text-bad" : "ml-2 text-warn"}>
              {t(d.updateFailed ? "hub:devices.updateFailed" : "hub:devices.outdated")}
            </span>
          )}
        </p>
        <p className="text-muted wrap-anywhere">{t("hub:devices.user", { name: d.userName })}</p>
        <p className="text-muted wrap-anywhere">
          {t("hub:devices.details", {
            os: d.os ?? t("hub:devices.unknown"),
            version: d.connectorVersion ?? t("hub:devices.unknown"),
          })}
        </p>
        {!d.online && (
          <p className="text-muted">
            {d.lastSeenAt
              ? t("hub:devices.lastSeen", { when: formatDateTime(d.lastSeenAt) })
              : t("hub:devices.neverSeen")}
          </p>
        )}
        {restart.isError && (
          <p role="alert" className="text-bad">
            {t("hub:edit.restartFailed")}
          </p>
        )}
        {restart.isSuccess && (
          <p role="status" className="text-muted">
            {t("hub:edit.restarting")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* An offline connector can't be asked: the edit page explains. */}
        <Button disabled={!d.online || restart.isPending} onClick={() => restart.mutate()}>
          {t("hub:devices.restart")}
        </Button>
        <Button variant="danger" onClick={onRevoke}>
          {t("hub:devices.revoke")}
        </Button>
      </div>
    </li>
  );
}

/** Hub management (ADR-0014): admin only, in the menu while the hub is on. */
export function HubPage() {
  const { t } = useTranslation();
  const devices = useDevices();
  const users = useUsers(true);
  const { pairingCode, revoke } = useDeviceActions();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const close = () => {
    setDialog(null);
    for (const m of [pairingCode, revoke]) m.reset();
  };
  const error = [pairingCode, revoke].some((m) => m.isError) ? t("hub:errors.generic") : undefined;
  const people = (users.data ?? [])
    .filter((u) => !u.disabled)
    .map((u) => ({ value: u.id, label: u.displayName }));

  return (
    <>
      <PageHeader
        title={t("hub:title")}
        description={t("hub:description")}
        actions={
          <>
            <Button variant="primary" onClick={() => setDialog({ kind: "pair" })}>
              {t("hub:pair.action")}
            </Button>
            <SettingsLink module="hub" />
          </>
        }
      />
      {devices.isError && (
        <p role="alert" className="text-bad">
          {t("hub:loadError")}
        </p>
      )}
      {devices.data &&
        (devices.data.length ? (
          <ul aria-label={t("hub:devices.label")} className="grid gap-2">
            {devices.data.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                onRevoke={() => setDialog({ kind: "revoke", device: d })}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={MonitorSmartphone}
            title={t("hub:devices.emptyTitle")}
            description={t("hub:devices.emptyBody")}
          />
        ))}

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
