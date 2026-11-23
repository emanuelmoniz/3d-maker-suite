import type { Device } from "@3d-maker-suite/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import type { BulkRow } from "../../components/ArchiveActions.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Section } from "../../components/Section.tsx";
import { SelectionBar, SelectionResult } from "../../components/SelectionBar.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { api } from "../../lib/api.ts";
import { textLink } from "../../lib/cx.ts";
import { formatDateTime, formatTime } from "../../lib/format.ts";
import { useDeviceActions, useDevices, usePairingCodes } from "../../lib/hub.ts";
import { DOCKER_UP, pairCommands, WINDOWS_ACCOUNT_SWITCHES } from "../../lib/pairCommands.ts";
import { useVersion } from "../../lib/updates.ts";
import { useUsers } from "../../lib/users.ts";
import { tileClass } from "../settings/IntegrationFormPage.tsx";
import { CommandBlock } from "./CommandBlock.tsx";

type Dialog = { kind: "pair" } | { kind: "code" | "headless"; code: string; expiresAt: string };

// Literal keys so `pnpm i18n:check` sees them.
const OS = {
  windows: "hub:devices.os.windows",
  linux: "hub:devices.os.linux",
  macos: "hub:devices.os.macos",
} as const;
/**
 * The connector reports `os.type()` first (`Windows_NT`, `Linux`, `Darwin`), then release and arch;
 * `process.platform` (`win32`, `linux`, `darwin`) reads the same.
 */
const baseOs = (os: string | null): keyof typeof OS | null => {
  const s = os?.toLowerCase() ?? "";
  return s.startsWith("win")
    ? "windows"
    : s.startsWith("darwin")
      ? "macos"
      : s.startsWith("linux")
        ? "linux"
        : null;
};

/**
 * The bar over ticked devices: Restart (live, so an offline one can't) and Revoke (asks first).
 * The ones that failed stay selected.
 */
function DeviceBar({
  rows,
  clear,
  done,
}: {
  rows: BulkRow[];
  clear: () => void;
  done: (blocked: string[]) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{
    action: "restart" | "revoke";
    failed: BulkRow[];
  } | null>(null);
  const run = async (action: "restart" | "revoke") => {
    setBusy(true);
    const results = await Promise.allSettled(
      rows.map((r) =>
        action === "restart"
          ? api("POST", `/api/hub/devices/${r.id}/restart`)
          : api("DELETE", `/api/hub/devices/${r.id}`),
      ),
    );
    const failed = rows.filter((_, i) => results[i]?.status === "rejected");
    setBusy(false);
    setAsking(false);
    setOutcome({ action, failed });
    done(failed.map((r) => r.id));
    // A restarted connector drops offline and comes back: look more often for a while.
    for (const ms of action === "restart" ? [2_000, 6_000, 12_000, 20_000] : [0])
      setTimeout(() => qc.invalidateQueries({ queryKey: ["hub", "devices"] }), ms);
  };
  return (
    <>
      <SelectionBar count={rows.length} onClear={clear}>
        <Button disabled={busy} onClick={() => void run("restart")}>
          {t("hub:devices.bulk.restart")}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => setAsking(true)}>
          {t("hub:devices.revoke")}
        </Button>
      </SelectionBar>
      <SelectionResult open={!!outcome} onDismiss={() => setOutcome(null)}>
        {outcome &&
          (outcome.failed.length ? (
            <>
              <p className="font-medium">
                {t("hub:devices.bulk.failed", { count: outcome.failed.length })}
              </p>
              <ul className="grid max-h-60 gap-1 overflow-y-auto">
                {outcome.failed.map((r) => (
                  <li key={r.id} className="wrap-anywhere">
                    {r.name}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="font-medium">
              {t(outcome.action === "restart" ? "hub:edit.restarting" : "hub:devices.bulk.revoked")}
            </p>
          ))}
      </SelectionResult>
      <ConfirmDialog
        open={asking}
        destructive
        title={t("hub:devices.bulk.revokeTitle", { count: rows.length })}
        description={t("hub:devices.revokeBody")}
        confirmLabel={t("hub:devices.revoke")}
        onCancel={() => setAsking(false)}
        onConfirm={() => void run("revoke")}
      />
    </>
  );
}

/** The devices, as the other lists; each one's actions are on its machine page (ADR-0021). */
function DeviceTable({ devices }: { devices: Device[] }) {
  const { t } = useTranslation();
  const unknown = t("hub:devices.unknown");
  const status = (d: Device) => (d.online ? "online" : "offline");
  const os = (d: Device) => {
    const base = baseOs(d.os);
    return base ? t(OS[base]) : (d.os ?? unknown);
  };
  return (
    <DataTable
      label={t("hub:devices.label")}
      rows={devices}
      rowKey={(d) => d.id}
      select={{ can: true, name: (d) => d.name, bar: (s) => <DeviceBar {...s} /> }}
      columns={[
        {
          id: "name",
          header: t("hub:devices.name"),
          cell: (d) => (
            <Link
              to="/hub/devices/$deviceId"
              params={{ deviceId: d.id }}
              className={`wrap-anywhere ${textLink}`}
            >
              {d.name}
            </Link>
          ),
          sortValue: (d) => d.name.toLocaleLowerCase(),
          filterValue: (d) => d.name,
        },
        {
          id: "status",
          header: t("hub:devices.columns.status"),
          cell: (d) => (
            <span className="grid">
              <span className={d.online ? "text-ok" : "text-muted"}>
                {t(d.online ? "hub:devices.online" : "hub:devices.offline")}
              </span>
              {!d.online && (
                <span className="text-sm text-muted">
                  {d.lastSeenAt
                    ? t("hub:devices.lastSeen", { when: formatDateTime(d.lastSeenAt) })
                    : t("hub:devices.neverSeen")}
                </span>
              )}
              {d.outdated && (
                <span className={d.updateFailed ? "text-sm text-bad" : "text-sm text-warn"}>
                  {t(d.updateFailed ? "hub:devices.updateFailed" : "hub:devices.outdated")}
                </span>
              )}
            </span>
          ),
          sortValue: status,
          filterValue: status,
          filterOptions: [
            { value: "online", label: t("hub:devices.online") },
            { value: "offline", label: t("hub:devices.offline") },
          ],
        },
        {
          id: "user",
          header: t("hub:devices.columns.user"),
          cell: (d) => d.userName,
          sortValue: (d) => d.userName.toLocaleLowerCase(),
          filterValue: (d) => d.userName,
        },
        {
          id: "os",
          header: t("hub:devices.columns.os"),
          cell: (d) => <span title={d.os ?? undefined}>{os(d)}</span>,
          sortValue: os,
          filterValue: (d) => baseOs(d.os) ?? "",
          filterOptions: (Object.keys(OS) as (keyof typeof OS)[]).map((k) => ({
            value: k,
            label: t(OS[k]),
          })),
        },
        {
          id: "version",
          header: t("hub:devices.columns.version"),
          cell: (d) => d.connectorVersion ?? unknown,
          sortValue: (d) => d.connectorVersion ?? "",
          filterValue: (d) => d.connectorVersion ?? "",
        },
      ]}
    />
  );
}

const choiceClass = `${tileClass} items-center py-2`;

// Literal keys so `pnpm i18n:check` sees them.
const KINDS = {
  desktop: { label: "hub:pair.kind.desktop", hint: "hub:pair.kindHint.desktop" },
  headless: { label: "hub:pair.kind.headless", hint: "hub:pair.kindHint.headless" },
} as const;
const HOWS = {
  docker: "hub:headless.docker",
  linux: "hub:headless.linux",
  windows: "hub:headless.windows",
} as const;
const PENDING_KINDS = {
  desktop: "hub:pending.kind.desktop",
  headless: "hub:pending.kind.headless",
} as const;

/** The commands for a NAS, server or container: the code and the hub's address filled in (ADR-0024). */
function HeadlessDialog({
  code,
  expiresAt,
  onClose,
}: {
  code: string;
  expiresAt: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const version = useVersion();
  const [hubUrl, setHubUrl] = useState(window.location.origin);
  const [how, setHow] = useState<"docker" | "linux" | "windows">("docker");
  const commands = pairCommands({ hubUrl: hubUrl.trim().replace(/\/+$/, ""), code, version });
  return (
    <AddDialog open title={t("hub:headless.title")} wide onClose={onClose}>
      <div className="grid gap-4">
        <p className="text-muted">{t("hub:headless.body", { time: formatDateTime(expiresAt) })}</p>
        <p className="select-all text-center font-mono text-2xl font-semibold tracking-widest">
          {code}
        </p>
        <FormField label={t("hub:headless.hubAddress")} hint={t("hub:headless.hubAddressHint")}>
          {(p) => (
            <input
              {...p}
              type="url"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              className={inputClass}
            />
          )}
        </FormField>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 font-medium">{t("hub:headless.how")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(HOWS) as (keyof typeof HOWS)[]).map((k) => (
              <label key={k} className={choiceClass}>
                <input type="radio" name="how" checked={how === k} onChange={() => setHow(k)} />
                <span>{t(HOWS[k])}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {how === "docker" && (
          <>
            <p className="text-muted">{t("hub:headless.dockerHint")}</p>
            <CommandBlock
              name={t(HOWS.docker)}
              text={commands.docker}
              copyLabel={t("hub:headless.copyCompose")}
            />
            <CommandBlock
              name={t("hub:headless.copyCommand")}
              text={DOCKER_UP}
              copyLabel={t("hub:headless.copyCommand")}
            />
          </>
        )}
        {how === "linux" && (
          <>
            <p className="text-muted">{t("hub:headless.linuxHint")}</p>
            <CommandBlock
              name={t(HOWS.linux)}
              text={commands.linux}
              copyLabel={t("hub:headless.copyCommands")}
            />
          </>
        )}
        {how === "windows" && (
          <>
            <p className="text-muted">{t("hub:headless.windowsHint")}</p>
            <CommandBlock
              name={t(HOWS.windows)}
              text={commands.windows}
              copyLabel={t("hub:headless.copyCommand")}
            />
            <p className="text-muted">{t("hub:headless.windowsAccount")}</p>
            <CommandBlock
              name={t("hub:headless.copyAccount")}
              text={WINDOWS_ACCOUNT_SWITCHES}
              copyLabel={t("hub:headless.copyAccount")}
            />
          </>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            {t("hub:code.done")}
          </Button>
        </div>
      </div>
    </AddDialog>
  );
}

/** Codes nobody used yet: a 24-hour one outlives the admin's visit, so it can be withdrawn. */
function PendingCodes() {
  const { t } = useTranslation();
  const codes = usePairingCodes();
  const { withdrawCode } = useDeviceActions();
  if (!codes.data?.length) return null;
  return (
    <Section title={t("hub:pending.title")}>
      <p className="text-muted">{t("hub:pending.hint")}</p>
      <ul className="grid gap-2">
        {codes.data.map((c) => {
          const when = formatDateTime(c.expiresAt);
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="wrap-anywhere">
                {t("hub:pending.line", {
                  user: c.userName,
                  kind: t(PENDING_KINDS[c.kind]),
                  when,
                })}
              </span>
              <Button
                aria-label={t("hub:pending.withdrawNamed", { user: c.userName, when })}
                disabled={withdrawCode.isPending}
                onClick={() => withdrawCode.mutate(c.id)}
              >
                {t("hub:pending.withdraw")}
              </Button>
            </li>
          );
        })}
      </ul>
      {withdrawCode.isError && (
        <p role="alert" className="text-bad">
          {t("hub:errors.generic")}
        </p>
      )}
    </Section>
  );
}

/** Hub management (ADR-0014): admin only, in the menu while the hub is on. */
export function HubPage() {
  const { t } = useTranslation();
  const devices = useDevices();
  const users = useUsers(true);
  const { pairingCode } = useDeviceActions();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const close = () => {
    setDialog(null);
    pairingCode.reset();
  };
  const error = pairingCode.isError ? t("hub:errors.generic") : undefined;
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
          <DeviceTable devices={devices.data} />
        ) : (
          <EmptyState
            icon={MonitorSmartphone}
            title={t("hub:devices.emptyTitle")}
            description={t("hub:devices.emptyBody")}
          />
        ))}
      <PendingCodes />

      <FormDialog
        open={dialog?.kind === "pair"}
        title={t("hub:pair.title")}
        submitLabel={t("hub:pair.submit")}
        error={error}
        busy={pairingCode.isPending}
        onCancel={close}
        onSubmit={(f) => {
          const kind = f.get("kind") === "headless" ? "headless" : "desktop";
          pairingCode.mutate(
            { userId: String(f.get("userId") ?? ""), kind },
            {
              onSuccess: ({ code, expiresAt }) =>
                setDialog({ kind: kind === "headless" ? "headless" : "code", code, expiresAt }),
            },
          );
        }}
      >
        <p className="text-muted">{t("hub:pair.hint")}</p>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 font-medium">{t("hub:pair.kindLegend")}</legend>
          {(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => (
            <label key={k} className={tileClass}>
              <input type="radio" name="kind" value={k} defaultChecked={k === "desktop"} />
              <span className="grid">
                <span className="font-medium">{t(KINDS[k].label)}</span>
                <span className="text-muted">{t(KINDS[k].hint)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <FormField label={t("hub:pair.user")}>
          {(p) => <Combobox {...p} name="userId" options={people} required />}
        </FormField>
      </FormDialog>
      {dialog?.kind === "headless" && (
        <HeadlessDialog code={dialog.code} expiresAt={dialog.expiresAt} onClose={close} />
      )}

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
        <div className="mt-3">
          <CopyButton
            value={dialog?.kind === "code" ? dialog.code : ""}
            label={t("hub:code.copy")}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
