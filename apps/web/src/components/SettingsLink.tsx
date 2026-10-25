import { Link, type LinkProps } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCan } from "../lib/auth.ts";

/** Gear button for a module's PageHeader actions; opens the module's config page; admins only. */
export function SettingsLink({
  module,
}: {
  module: "quotes" | "orders" | "prints" | "projects" | "alerts" | "printers" | "filament";
}) {
  const { t } = useTranslation();
  const admin = useCan("admin");
  if (!admin) return null;
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
