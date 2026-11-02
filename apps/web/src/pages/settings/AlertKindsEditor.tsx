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

// Written out so `pnpm i18n:check` sees the keys.
const KIND_LABELS: Record<AlertKind, string> = {
  maintenance_due: "users:alerts.kinds.maintenance_due",
  spool_low: "users:alerts.kinds.spool_low",
  spool_no_price: "users:alerts.kinds.spool_no_price",
  spool_no_open_date: "users:alerts.kinds.spool_no_open_date",
  warranty_ending: "users:alerts.kinds.warranty_ending",
  sync_pending: "users:alerts.kinds.sync_pending",
  sync_success: "users:alerts.kinds.sync_success",
  sync_error: "users:alerts.kinds.sync_error",
  slice_setup_changed: "users:alerts.kinds.slice_setup_changed",
  slice_failed: "users:alerts.kinds.slice_failed",
  update_available: "users:alerts.kinds.update_available",
  slicer_update: "users:alerts.kinds.slicer_update",
  connector_outdated: "users:alerts.kinds.connector_outdated",
  hub_conflict: "users:alerts.kinds.hub_conflict",
  hub_mass_delete: "users:alerts.kinds.hub_mass_delete",
  preset_conflict: "users:alerts.kinds.preset_conflict",
  preset_skipped: "users:alerts.kinds.preset_skipped",
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
