import {
  ALERT_KIND_CATALOG,
  ALERT_KINDS,
  ALERT_SUBSCRIPTIONS,
  type AlertKind,
  type AlertKinds,
  type AlertSubscription,
  type Permissions,
} from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";

// The names the Alerts page uses, so a kind has one name everywhere.
// Written out so `pnpm i18n:check` sees the keys.
const KIND_LABELS: Record<AlertKind, string> = {
  maintenance_due: "alerts:kindNames.maintenance_due",
  spool_low: "alerts:kindNames.spool_low",
  spool_no_price: "alerts:kindNames.spool_no_price",
  spool_no_open_date: "alerts:kindNames.spool_no_open_date",
  warranty_ending: "alerts:kindNames.warranty_ending",
  sync_pending: "alerts:kindNames.sync_pending",
  sync_success: "alerts:kindNames.sync_success",
  sync_error: "alerts:kindNames.sync_error",
  slice_setup_changed: "alerts:kindNames.slice_setup_changed",
  slice_failed: "alerts:kindNames.slice_failed",
  update_available: "alerts:kindNames.update_available",
  slicer_update: "alerts:kindNames.slicer_update",
  connector_outdated: "alerts:kindNames.connector_outdated",
  hub_conflict: "alerts:kindNames.hub_conflict",
  hub_mass_delete: "alerts:kindNames.hub_mass_delete",
  preset_conflict: "alerts:kindNames.preset_conflict",
  preset_skipped: "alerts:kindNames.preset_skipped",
  preset_held: "alerts:kindNames.preset_held",
  print_finished: "alerts:kindNames.print_finished",
  print_failed: "alerts:kindNames.print_failed",
  printer_offline: "alerts:kindNames.printer_offline",
  printer_unreachable: "alerts:kindNames.printer_unreachable",
  filament_review: "alerts:kindNames.filament_review",
};
const SUB_LABELS: Record<AlertSubscription, string> = {
  off: "users:alerts.sub.off",
  app: "users:alerts.sub.app",
  notify: "users:alerts.sub.notify",
};

/**
 * Per kind: off · in app · notify. A role sets its defaults; a user (`role` given) overrides them,
 * or follows the role. Only the kinds `permissions` allow are listed (ADR-0016).
 */
export function AlertKindsEditor({
  permissions,
  value,
  role,
  disabled,
  onChange,
}: {
  permissions: Permissions;
  /** A role's kinds, or a user's overrides. */
  value: Partial<AlertKinds>;
  /** The user's role: its kinds are what "same as role" gives. */
  role?: Partial<AlertKinds>;
  disabled?: boolean;
  onChange: (next: Partial<AlertKinds>) => void;
}) {
  const { t } = useTranslation();
  const shown = ALERT_KINDS.filter((k) => ALERT_KIND_CATALOG[k].needs(permissions));
  const base = (k: AlertKind): AlertSubscription => role?.[k] ?? ALERT_KIND_CATALOG[k].default;

  if (!shown.length) return <p className="text-muted">{t("users:alerts.none")}</p>;
  return (
    <div>
      {shown.map((k) => {
        const id = `alert-kind-${k}`;
        const set = value[k];
        return (
          <div
            key={k}
            className="grid gap-x-6 gap-y-1 border-t border-border py-2 md:grid-cols-[minmax(0,1fr)_14rem] md:items-center"
          >
            <label htmlFor={id} className="font-medium">
              {t(KIND_LABELS[k])}
            </label>
            <select
              id={id}
              disabled={disabled}
              value={role && set === undefined ? "" : (set ?? base(k))}
              onChange={(e) => {
                const { [k]: _, ...rest } = value;
                onChange(
                  e.target.value ? { ...rest, [k]: e.target.value as AlertSubscription } : rest,
                );
              }}
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            >
              {role && (
                <option value="">
                  {t("users:alerts.sameAsRole", { value: t(SUB_LABELS[base(k)]) })}
                </option>
              )}
              {ALERT_SUBSCRIPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(SUB_LABELS[s])}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
