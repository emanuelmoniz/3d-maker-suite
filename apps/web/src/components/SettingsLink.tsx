import type { Permission } from "@3d-maker-suite/core";
import { Link, type LinkProps } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCan, useRights } from "../lib/auth.ts";
import { type AccountType, feeds, useIntegrations, useMayTask } from "../lib/integrations.ts";

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

/** The modules whose Sources tab lists accounts, and the type they feed (ADR-0021). */
export const ACCOUNT_TYPE: Partial<Record<SettingsModule, AccountType>> = {
  printers: "printers",
  prints: "prints",
  filament: "spools",
};

/**
 * The settings page, or only its Sources tab: an editor may sync or review an account's type
 * there without the settings (ADR-0012), as they could on its card before ADR-0021.
 */
export function useSettingsAccess(module: SettingsModule) {
  const settings = useCanSettings(module);
  const p = useRights()?.permissions;
  const type = ACCOUNT_TYPE[module];
  const tasks =
    !!type &&
    !settings &&
    !!(p?.["integrations.sync"] || p?.["integrations.review"] || p?.["integrations.manage"]);
  const may = useMayTask();
  const { data } = useIntegrations(tasks);
  const sources =
    settings || (tasks && !!data?.some((i) => feeds(i, type) && may(i.id, type, "any")));
  // Until the list is in, a task can't be told from none.
  return { settings, sources, loading: tasks && !data };
}

/** Gear button for a module's PageHeader actions; opens the module's config page. */
export function SettingsLink({ module }: { module: SettingsModule }) {
  const { t } = useTranslation();
  const { settings, sources } = useSettingsAccess(module);
  if (!sources) return null;
  const label = t("common:actions.moduleSettings", { module: t(`nav:items.${module}.label`) });
  return (
    <Link
      to={`/${module}/settings${settings ? "" : "/sources"}` as LinkProps["to"]}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-surface transition-colors hover:bg-surface-2"
    >
      <Settings className="size-4" aria-hidden="true" />
    </Link>
  );
}
