import type { Root } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";

/**
 * "Offline" (its device isn't connected: last known data) or "Missing" for a root or a project in
 * one (ADR-0014); nothing when it's there.
 */
export function RootStateBadge({ state }: { state: Root["state"] }) {
  const { t } = useTranslation();
  if (state === "ok") return null;
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${state === "offline" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad"}`}
    >
      {t(state === "offline" ? "common:rootState.offline" : "common:rootState.missing")}
    </span>
  );
}
