import type { Root } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";

const LABELS = {
  offline: "common:rootState.offline",
  missing: "common:rootState.missing",
  unshared: "common:rootState.unshared",
} as const;

const badge = "inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium";

/**
 * What a root's disk means for it (Plan 6.3.0 Step 5): "Rescanned only" on a network share, where
 * only the scheduled rescan sees changes made elsewhere, and "Read-only" on a read-only mount.
 */
export function RootMountBadges({ mount }: { mount: Root["mount"] }) {
  const { t } = useTranslation();
  if (!mount || (!mount.share && !mount.readOnly)) return null;
  return (
    <>
      {mount.share && (
        <span className={`${badge} bg-warn/15 text-warn`}>{t("common:rootMount.share")}</span>
      )}
      {mount.readOnly && (
        <span className={`${badge} bg-warn/15 text-warn`}>{t("common:rootMount.readOnly")}</span>
      )}
    </>
  );
}

/**
 * "Offline" (its device isn't connected: last known data), "Not shared on the device" (also last
 * known data) or "Missing" for a root or a project in one (ADR-0014); nothing when it's there.
 */
export function RootStateBadge({ state }: { state: Root["state"] }) {
  const { t } = useTranslation();
  if (state === "ok") return null;
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${state === "missing" ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn"}`}
    >
      {t(LABELS[state])}
    </span>
  );
}
