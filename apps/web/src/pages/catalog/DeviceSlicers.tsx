import type { PresetDevice, PresetInstallSlicer } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Switch } from "../../components/Switch.tsx";
import { ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { usePresetDevices, useUpdatePresetDevice } from "../../lib/presets.ts";

const cx = (...c: (string | false)[]) => c.filter(Boolean).join(" ");

/** Where Install writes on one slicer of a device, what waits there and its last backup. */
function InstallDetails({ s, slicer }: { s: PresetInstallSlicer; slicer: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-0.5 text-sm">
      <p className="text-muted">
        {s.queued
          ? t(s.waiting ? "hub:presets.queueWaiting" : "hub:presets.queue", { count: s.queued })
          : t("hub:presets.queueEmpty")}
      </p>
      {s.queue.length > 0 && (
        <ul
          aria-label={t("hub:presets.queueOf", { name: slicer })}
          className="text-muted wrap-anywhere"
        >
          {s.queue.map((q) => (
            <li key={`${q.kind}/${q.name}`}>{q.name}</li>
          ))}
        </ul>
      )}
      {s.editsStayLocal && <p className="text-warn">{t("hub:presets.editsStayLocal")}</p>}
      {s.deleteHere.length > 0 && (
        <>
          <p className="text-warn">{t("hub:presets.deleteHere", { count: s.deleteHere.length })}</p>
          <ul
            aria-label={t("hub:presets.deleteHereOf", { name: slicer })}
            className="text-muted wrap-anywhere"
          >
            {s.deleteHere.map((q) => (
              <li key={`${q.kind}/${q.name}`}>{q.name}</li>
            ))}
          </ul>
        </>
      )}
      <details className="text-muted">
        <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-accent">
          {t("catalog:sources.devices.where")}
        </summary>
        <p className="wrap-anywhere">{t("hub:presets.installFolder", { folder: s.folder })}</p>
        <p className="wrap-anywhere">
          {s.backup
            ? t("hub:presets.backup", { when: formatDateTime(s.backup.at), path: s.backup.path })
            : t("hub:presets.noBackup")}
        </p>
      </details>
    </div>
  );
}

/**
 * Catalog → Sources, hub on: one row per device that reports this slicer (or did), with Send
 * presets and Install and how they stand (ADR-0020). The only place the two are edited.
 */
export function DeviceSlicers({ library, slicer }: { library: string; slicer: string }) {
  const { t } = useTranslation();
  const devices = usePresetDevices(true);
  const update = useUpdatePresetDevice();
  const rows = (devices.data ?? []).flatMap((d) =>
    d.libraries.filter((l) => l.library === library).map((l) => ({ d, l })),
  );
  const outdated = update.error instanceof ApiError && update.error.code === "device_outdated";
  const set = (d: PresetDevice, change: { send?: boolean; install?: boolean }) =>
    update.mutate({ id: d.id, library, ...change });
  const id = `devices-${library}`;
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="grid scroll-mt-4 gap-3">
      <div className="grid gap-1">
        <h3 id={`${id}-title`} className="font-semibold">
          {t("catalog:sources.devices.title")}
        </h3>
        <p className="max-w-prose text-muted">{t("catalog:sources.devices.hint", { slicer })}</p>
      </div>
      {update.isError && (
        <p role="alert" className="text-bad">
          {t(outdated ? "catalog:sources.devices.outdatedError" : "hub:errors.generic")}
        </p>
      )}
      {!devices.data ? null : rows.length ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full border-collapse text-left">
            <thead className="sr-only sm:not-sr-only sm:table-header-group">
              <tr className="border-b border-border bg-surface-2 text-muted">
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("catalog:sources.devices.device")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("catalog:sources.devices.send")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("catalog:sources.devices.install")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("catalog:sources.devices.held")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ d, l }) => (
                <tr
                  key={d.id}
                  className={cx(
                    "grid gap-2 border-b border-border px-3 py-3 last:border-b-0 sm:table-row sm:px-0 sm:py-0",
                    !l.reported && "text-muted",
                  )}
                >
                  <th
                    scope="row"
                    className="block font-normal sm:table-cell sm:w-1/4 sm:px-3 sm:py-3 sm:align-top"
                  >
                    <span className="block font-medium wrap-anywhere">{d.name}</span>
                    {!d.online && (
                      <span className="block text-sm text-muted">
                        {t("hub:presets.deviceOffline")}
                      </span>
                    )}
                    {!l.reported && (
                      <span className="block text-sm text-muted">
                        {t("catalog:sources.devices.notReported", { slicer })}
                      </span>
                    )}
                    {d.outdated && (
                      <span className="block text-sm text-warn">
                        {t("hub:presets.deviceOutdated")}
                      </span>
                    )}
                  </th>
                  <td className="block sm:table-cell sm:px-3 sm:py-3 sm:align-top">
                    <Switch
                      label={t("catalog:sources.devices.send")}
                      labelClassName="sm:sr-only"
                      aria-label={t("catalog:sources.devices.sendOn", { slicer, device: d.name })}
                      checked={l.send}
                      disabled={!l.reported || update.isPending}
                      onChange={(e) => set(d, { send: e.target.checked })}
                    />
                    <p className="text-sm text-muted">
                      {l.sentAt
                        ? t("catalog:sources.devices.sentAt", { when: formatDateTime(l.sentAt) })
                        : t("catalog:sources.devices.neverSent")}
                    </p>
                  </td>
                  <td className="block sm:table-cell sm:px-3 sm:py-3 sm:align-top">
                    <Switch
                      label={t("catalog:sources.devices.install")}
                      labelClassName="sm:sr-only"
                      aria-label={t("catalog:sources.devices.installOn", {
                        slicer,
                        device: d.name,
                      })}
                      checked={l.install}
                      disabled={!l.reported || update.isPending}
                      onChange={(e) => set(d, { install: e.target.checked })}
                    />
                    {l.status ? (
                      <InstallDetails s={l.status} slicer={slicer} />
                    ) : (
                      l.install && (
                        <p className="text-sm text-muted">
                          {t("catalog:sources.devices.noReport")}
                        </p>
                      )
                    )}
                  </td>
                  <td className="block text-sm sm:table-cell sm:w-1/6 sm:px-3 sm:py-3 sm:align-top">
                    {l.held ? (
                      <Link to="/catalog/presets" className="text-warn underline">
                        {t("catalog:sources.devices.heldCount", { count: l.held })}
                      </Link>
                    ) : (
                      <span className="text-muted">{t("catalog:sources.devices.noneHeld")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">{t("catalog:sources.devices.none", { slicer })}</p>
      )}
    </section>
  );
}
