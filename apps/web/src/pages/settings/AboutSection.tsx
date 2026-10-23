import type { Preferences, UpdatesResponse } from "@3d-maker-suite/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField } from "../../components/FormField.tsx";
import { ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";
import { useCheckUpdates, useRunUpdate, useUpdates } from "../../lib/updates.ts";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const ERRORS: Record<string, string> = {
  dirty: "settings:updates.errors.dirty",
  busy: "settings:updates.errors.busy",
  fetch_failed: "settings:updates.errors.fetch_failed",
  git_failed: "settings:updates.errors.git_failed",
  invalid_backup: "settings:updates.errors.invalid_backup",
  bad_checksum: "settings:updates.errors.bad_checksum",
  needs_installer: "settings:updates.errors.needs_installer",
};
const STEPS = {
  checkout: "settings:updates.steps.checkout",
  node: "settings:updates.steps.node",
  install: "settings:updates.steps.install",
  build: "settings:updates.steps.build",
  start: "settings:updates.steps.start",
} as const;
/** Installs that update themselves through the launcher. */
const SELF = ["git", "bundle"];
const PHASES = {
  preparing: "settings:updates.phases.preparing",
  installing: "settings:updates.phases.installing",
  slow: "settings:updates.phases.slow",
} as const;

type Entry = UpdatesResponse["history"][number];
const code = "block overflow-x-auto whitespace-pre rounded-md bg-surface-2 p-3 font-mono text-sm";

/** What to type when the app can't update itself (Docker, a zip, `pnpm dev`). */
function Manual({ install, tag }: { install: UpdatesResponse["install"]; tag: string }) {
  const { t } = useTranslation();
  const docker = install === "docker";
  return (
    <div className="grid gap-2">
      <p>{t(docker ? "settings:updates.manualDocker" : "settings:updates.manualGit")}</p>
      <code className={code}>
        {docker
          ? "docker compose pull\ndocker compose up -d"
          : `git fetch --tags\ngit checkout ${tag}\npnpm install\npnpm start`}
      </code>
    </div>
  );
}

function HistoryRow({ e, onRollBack }: { e: Entry; onRollBack: () => void }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {t(e.action === "update" ? "settings:updates.updated" : "settings:updates.rolledBack", {
            from: e.fromVersion,
            to: e.toVersion,
          })}
        </div>
        <div className={e.ok ? "text-muted" : "text-bad"}>
          {formatDateTime(e.at)}
          {!e.ok &&
            ` · ${t("settings:updates.failed", {
              step: t(STEPS[e.failedStep ?? "checkout"], { node: e.needsNode }),
            })}`}
        </div>
      </div>
      {e.canRollBack && (
        <Button onClick={onRollBack}>
          {t("settings:updates.rollBackTo", { version: e.fromVersion })}
        </Button>
      )}
    </li>
  );
}

/** Version, channel, check, update and rollback (ADR-0009). */
export function AboutSection() {
  const { t } = useTranslation();
  const { data } = useUpdates();
  const prefs = usePreferences().data?.values;
  const save = useSavePreferences();
  const check = useCheckUpdates();
  const run = useRunUpdate();
  const [confirm, setConfirm] = useState<{ tag: string } | Entry | null>(null);
  useEffect(() => {
    if (data && location.hash === "#updates") document.getElementById("updates")?.scrollIntoView();
  }, [data]);
  if (!data || !prefs) return null;

  const { latest, install } = data;
  const last = data.history[0];
  const busy = run.isPending || run.phase === "slow";
  const err = run.error instanceof ApiError ? run.error.code : undefined;

  return (
    <div className="grid gap-4">
      <p className="text-lg font-semibold">{t("common:version", { version: data.version })}</p>

      <FormField label={t("settings:updates.channel")} hint={t("settings:updates.channelHint")}>
        {(p) => (
          <Combobox
            {...p}
            value={prefs.updateChannel}
            onChange={(x) => save.mutate({ updateChannel: x as Preferences["updateChannel"] })}
            options={[
              { value: "stable", label: t("settings:updates.stable") },
              { value: "dev", label: t("settings:updates.dev") },
            ]}
          />
        )}
      </FormField>

      <div role="status" className="grid gap-1">
        {latest ? (
          <p className="font-medium text-ok">
            {t("settings:updates.available", { version: latest.tag.slice(1) })}{" "}
            <a
              className="text-accent hover:underline"
              href={latest.url}
              target="_blank"
              rel="noreferrer"
            >
              {t("settings:updates.notes")}
            </a>
          </p>
        ) : data.checkedAt && !data.checkFailed ? (
          <p>{t("settings:updates.upToDate")}</p>
        ) : null}
        {data.checkFailed && <p className="text-bad">{t("settings:updates.checkFailed")}</p>}
        {data.checkedAt && (
          <p className="text-muted">
            {t("settings:updates.checkedAt", { date: formatDateTime(data.checkedAt) })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={check.isPending || busy} onClick={() => check.mutate()}>
          {t("settings:updates.checkNow")}
        </Button>
        {latest && SELF.includes(install) && (
          <Button variant="primary" disabled={busy} onClick={() => setConfirm({ tag: latest.tag })}>
            {t("settings:updates.update", { version: latest.tag.slice(1) })}
          </Button>
        )}
      </div>

      {latest && !SELF.includes(install) && <Manual install={install} tag={latest.tag} />}

      {run.phase in PHASES && (
        <p role="status" className="font-medium">
          {t(PHASES[run.phase as keyof typeof PHASES])}
        </p>
      )}
      {run.phase === "back" && last && !last.ok && (
        <p role="alert" className="text-bad">
          {t("settings:updates.wentBack", {
            version: last.toVersion,
            step: t(STEPS[last.failedStep ?? "checkout"], { node: last.needsNode }),
            current: data.version,
          })}
        </p>
      )}
      {run.isError && (
        <p role="alert" className="text-bad">
          {t(ERRORS[err ?? ""] ?? "settings:updates.errors.unknown")}
        </p>
      )}

      {data.history.length > 0 && (
        <div className="grid gap-2">
          <h3 className="font-medium">{t("settings:updates.history")}</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {data.history.map((e) => (
              <HistoryRow key={e.at} e={e} onRollBack={() => setConfirm(e)} />
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        destructive={confirm !== null && !("tag" in confirm)}
        title={
          confirm && "tag" in confirm
            ? t("settings:updates.confirmUpdate", { version: confirm.tag.slice(1) })
            : t("settings:updates.confirmRollBack", {
                version: (confirm as Entry | null)?.fromVersion,
              })
        }
        description={
          confirm && "tag" in confirm
            ? t("settings:updates.confirmUpdateBody")
            : t("settings:updates.confirmRollBackBody", {
                date: confirm && "at" in confirm ? formatDateTime(confirm.at) : "",
              })
        }
        confirmLabel={
          confirm && "tag" in confirm
            ? t("settings:updates.update", { version: confirm.tag.slice(1) })
            : t("settings:updates.rollBack")
        }
        onConfirm={() => {
          if (confirm)
            run.mutate("tag" in confirm ? { tag: confirm.tag } : { backup: confirm.backup });
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
