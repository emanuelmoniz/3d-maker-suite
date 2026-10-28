import type { Device } from "@3d-maker-suite/core";
import { MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { formatDateTime, formatTime } from "../../lib/format.ts";
import { useDeviceActions, useDevices } from "../../lib/hub.ts";
import { useUsers } from "../../lib/users.ts";

type Dialog =
  | { kind: "pair" }
  | { kind: "code"; code: string; expiresAt: string }
  | { kind: "rename" | "revoke"; device: Device };

/** Hub management (ADR-0014): admin only, in the menu while the hub is on. */
export function HubPage() {
  const { t } = useTranslation();
  const devices = useDevices();
  const users = useUsers(true);
  const { pairingCode, rename, revoke } = useDeviceActions();
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
                  </p>
                  <p className="text-muted wrap-anywhere">
                    {t("hub:devices.details", {
                      user: d.userName,
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
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
