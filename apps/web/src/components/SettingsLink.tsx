import type { Permission } from "@3d-maker-suite/core";
import { Link, type LinkProps } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCan } from "../lib/auth.ts";

export type SettingsModule =
  | "quotes"
  | "orders"
  | "prints"
  | "projects"
  | "alerts"
  | "printers"
  | "filament"
  | "catalog"
  | "presets"
  | "hub";

/** What opens a module's settings page (ADR-0016): manage on a module, or the on/off permission. */
const SETTINGS_PERMISSION: Record<SettingsModule, Permission> = {
  quotes: "costs",
  orders: "costs",
  prints: "prints",
  projects: "projects",
  alerts: "settings.alerts",
  printers: "printers",
  filament: "filament",
  catalog: "catalog",
  presets: "presets",
  hub: "hub.manage",
};

/**
 * Presets settings open with read: their Library and Sources tabs were Catalog tabs that read
 * showed (ADR-0021); each control in them checks its own level.
 */
export const useCanSettings = (module: SettingsModule) =>
  useCan(SETTINGS_PERMISSION[module], module === "presets" ? "read" : "manage");

/** Gear button for a module's PageHeader actions; opens the module's config page. */
export function SettingsLink({ module }: { module: SettingsModule }) {
  const { t } = useTranslation();
  if (!useCanSettings(module)) return null;
  const label = t("common:actions.moduleSettings", { module: t(`nav:items.${module}.label`) });
  return (
    <Link
      to={`/${module}/settings` as LinkProps["to"]}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-surface transition-colors hover:bg-surface-2"
    >
      <Settings className="size-4" aria-hidden="true" />
    </Link>
  );
}
