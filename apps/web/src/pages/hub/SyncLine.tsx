import type { Device } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";

/** The device's last sync report of the hub roots, as one line. */
export function SyncLine({ sync }: { sync: NonNullable<Device["sync"]> }) {
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
