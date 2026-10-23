import {
  ALERT_SEVERITIES,
  type AlertSeverity,
  type Capability,
  type Integration,
  isAction,
  REVIEWED_TYPES,
  type ReviewedType,
  type SyncFrequency,
  type SyncMerge,
  type SyncPolicy,
  type SyncRequest,
  type SyncScope,
} from "@3d-maker-suite/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Switch } from "../../components/Switch.tsx";
import { formatDateTime, formatNumber, formatRelative, formatTime } from "../../lib/format.ts";
import { usePatchIntegration, type useSyncIntegration } from "../../lib/integrations.ts";
import { CAPS } from "./integrationLabels.ts";

const RANGES = {
  sinceLast: "integrations:sync.ranges.sinceLast",
  d7: "integrations:sync.ranges.d7",
  d30: "integrations:sync.ranges.d30",
  d90: "integrations:sync.ranges.d90",
  year: "integrations:sync.ranges.year",
  custom: "integrations:sync.ranges.custom",
};
const FREQUENCIES: Record<SyncFrequency, string> = {
  "15m": "integrations:sync.frequencies.15m",
  "1h": "integrations:sync.frequencies.1h",
  "1d": "integrations:sync.frequencies.1d",
  "1w": "integrations:sync.frequencies.1w",
  "1M": "integrations:sync.frequencies.1M",
};
const SEVERITY = {
  error: "integrations:policies.alertSeverity.error",
  warning: "integrations:policies.alertSeverity.warning",
  success: "integrations:policies.alertSeverity.success",
} as const satisfies Record<AlertSeverity, string>;
const SCOPES: Record<SyncScope, string> = {
  all: "integrations:policies.scopes.all",
  imported: "integrations:policies.scopes.imported",
};
const SCOPE_HINTS: Record<SyncScope, string> = {
  all: "integrations:policies.scopeHints.all",
  imported: "integrations:policies.scopeHints.imported",
};
const MERGES: Record<SyncMerge, string> = {
  overwrite: "integrations:policies.merges.overwrite",
  keepEdits: "integrations:policies.merges.keepEdits",
  review: "integrations:policies.merges.review",
};
const MERGE_HINTS: Record<SyncMerge, string> = {
  overwrite: "integrations:policies.mergeHints.overwrite",
  keepEdits: "integrations:policies.mergeHints.keepEdits",
  review: "integrations:policies.mergeHints.review",
};
const GROUPS = {
  devices: "integrations:policies.groups.devices",
  catalog: "integrations:policies.groups.catalog",
  actions: "integrations:policies.groups.actions",
};
const DEVICES: readonly Capability[] = ["printers", "prints", "spools"];
const groupOf = (c: Capability): keyof typeof GROUPS =>
  isAction(c) ? "actions" : DEVICES.includes(c) ? "devices" : "catalog";
// Types whose rows are reviewed and confirmed. They can also run straight from here: a run
// imports the rows that need no decision (catalog rows, spools with one matching profile, presets
// whose brand and material exist) and leaves the rest pending for the review page.
const isReviewed = (c: Capability): c is ReviewedType =>
  (REVIEWED_TYPES as readonly string[]).includes(c);

type At = Pick<SyncPolicy, "atMinute" | "atHour" | "atWeekday" | "atDay">;
// The fields each frequency's time uses (the server's `schedulePattern`); a time input sets 1d's.
const AT_FIELDS: Record<SyncFrequency, (keyof At)[]> = {
  "15m": ["atMinute"],
  "1h": ["atMinute"],
  "1d": ["atHour", "atMinute"],
  "1w": ["atWeekday", "atHour"],
  "1M": ["atDay", "atHour"],
};
const AT_LABELS: Record<keyof At, string> = {
  atMinute: "integrations:policies.at.minute",
  atHour: "integrations:policies.at.hour",
  atWeekday: "integrations:policies.at.weekday",
  atDay: "integrations:policies.at.day",
};
// Monday first; 0 is Sunday, as on the server.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const pad = (n: number) => String(n).padStart(2, "0");

type Patch = ReturnType<typeof usePatchIntegration>;
type Sync = ReturnType<typeof useSyncIntegration>;

const startOfDay = (daysAgo: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

/** The range for "Sync prints"; empty = continue from the last sync. Custom dates are local days. */
function rangeFor(range: keyof typeof RANGES, from: string, to: string): Partial<SyncRequest> {
  if (range === "d7") return { from: startOfDay(7) };
  if (range === "d30") return { from: startOfDay(30) };
  if (range === "d90") return { from: startOfDay(90) };
  if (range === "year") return { from: new Date(new Date().getFullYear(), 0, 1).toISOString() };
  if (range !== "custom") return {};
  return {
    ...(from && { from: new Date(`${from}T00:00:00`).toISOString() }),
    ...(to && { to: new Date(`${to}T23:59:59.999`).toISOString() }),
  };
}

/** The integration's types in groups (devices & prints, catalog, slicer actions), one row each. */
export function Policies({ integration: i, sync }: { integration: Integration; sync: Sync }) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  const tracking = (type: string) =>
    i.policies.some((p) => p.type === type && p.mode !== "off" && p.trackUsage);
  const doubleTracking = tracking("prints") && tracking("spools");
  return (
    // The rows follow the card's width, not the screen's: one line when there is room.
    <div className="@container mt-2 grid gap-4">
      {patch.isError && (
        <p role="alert" className="text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}
      {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((g) => {
        const rows = i.policies.filter((p) => groupOf(p.type) === g);
        if (!rows.length) return null;
        const id = `${i.id}-${g}`;
        return (
          <section key={g} aria-labelledby={id} className="grid gap-2">
            <h3 id={id} className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t(GROUPS[g])}
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((p) => (
                <PolicyRow key={p.type} integration={i} policy={p} sync={sync} patch={patch} />
              ))}
            </ul>
            {g === "devices" && doubleTracking && (
              <p role="status" className="text-warn">
                {t("integrations:policies.doubleTracking")}
              </p>
            )}
          </section>
        );
      })}
      <p className="text-muted">{t("integrations:policies.hint")}</p>
    </div>
  );
}

/**
 * Data types: Auto or Manual, last sync, Sync now, Manual import and rows to review; the Auto
 * switch (off = manual), frequency, alerts and the rest behind a toggle. Actions: just on or off.
 */
function PolicyRow({
  integration: i,
  policy: p,
  sync,
  patch,
}: {
  integration: Integration;
  policy: SyncPolicy;
  sync: Sync;
  patch: Patch;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<keyof typeof RANGES>("sinceLast");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const name = t(CAPS[p.type]);
  const set = (change: Partial<Omit<SyncPolicy, "type" | "lastRunAt" | "pending">>) =>
    patch.mutate({ policies: [{ type: p.type, ...change }] });
  const options = (map: Record<string, string>) =>
    Object.entries(map).map(([value, key]) => ({ value, label: t(key) }));

  if (isAction(p.type))
    return (
      <li className="px-3 py-1">
        <Switch
          label={name}
          checked={p.mode !== "off"}
          disabled={patch.isPending}
          onChange={(e) => set({ mode: e.target.checked ? "manual" : "off" })}
        />
      </li>
    );

  const type = p.type;
  const prints = type === "prints";
  // Switched off or not set up (no sign-in, no folder): nothing to run.
  const active = i.capabilities.includes(type);
  const customInvalid = prints && range === "custom" && (!from || (!!to && to < from));
  const dates = prints ? rangeFor(range, from, to) : {};
  const review = isReviewed(type)
    ? ({
        to: "/import/$source/$id/$type",
        params: { source: "integration", id: i.id, type },
        search: dates as never,
      } as const)
    : null;
  const run = () =>
    review
      ? sync.mutate(
          { type: review.params.type, ...dates },
          // Rows were left for a person: take them there.
          { onSuccess: (r) => void (r.pending > 0 && navigate(review)) },
        )
      : sync.mutate({ type });
  const picked = (s: AlertSeverity) => p.alertSeverities?.includes(s) ?? true;
  const trackHint = `${detailsId}-track`;
  const auto = p.mode === "auto";
  // A run left rows for a person: the row says so, in the same yellow as the alert.
  const waiting = !!review && active && p.pending > 0;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-1.5 @2xl:grid-cols-[11rem_5rem_7rem_auto_minmax(0,1fr)_auto]">
      <span className="truncate font-medium">{name}</span>
      <span
        className={`justify-self-start rounded-full px-2 py-0.5 text-xs font-medium ${auto ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}
      >
        {t(auto ? "integrations:policies.modes.auto" : "integrations:policies.modes.manual")}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={t("integrations:policies.detailsOf", { type: name })}
        onClick={() => setOpen(!open)}
        className="inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-2 @2xl:order-last"
      >
        <ChevronRight
          aria-hidden
          className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {/* Its own line on a narrow card; part of the one-line grid on a wide one. */}
      <div className="col-span-full flex flex-wrap items-center gap-x-3 @2xl:contents">
        <span className="text-muted">
          <span className="sr-only">{t("integrations:policies.lastRun")}: </span>
          {p.lastRunAt ? (
            // ponytail: "5 min. ago" goes stale until the integration refetches; tick it if it matters.
            <time dateTime={p.lastRunAt} title={formatDateTime(p.lastRunAt)}>
              {formatRelative(p.lastRunAt)}
            </time>
          ) : (
            t("integrations:policies.never")
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {active && (
            <Button className="my-1" disabled={sync.isPending || customInvalid} onClick={run}>
              {t("integrations:policies.syncNow")}
            </Button>
          )}
          {review && active && (
            <Link
              {...review}
              className={`my-1 inline-flex h-9 items-center justify-center rounded-md border px-3 font-medium transition-colors ${waiting ? "border-warn bg-warn/15 text-warn hover:bg-warn/25" : "border-border bg-surface hover:bg-surface-2"}`}
            >
              {t("integrations:policies.importNow")}
            </Link>
          )}
        </span>
        {waiting ? (
          <span className="flex items-center gap-1 font-medium text-warn">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {t("integrations:policies.pending", { count: p.pending })}
          </span>
        ) : (
          <span />
        )}
      </div>

      <div
        id={detailsId}
        hidden={!open}
        className="col-span-full mb-2 grid gap-4 rounded-md bg-surface-2 p-3 @2xl:order-last"
      >
        <fieldset className="grid gap-3">
          <legend className="mb-2 font-semibold">{t("integrations:card.sync")}</legend>
          <div className="grid items-end gap-3 @xl:grid-cols-2">
            <Switch
              label={t("integrations:policies.auto")}
              aria-label={t("integrations:policies.autoOf", { type: name })}
              checked={auto}
              disabled={patch.isPending}
              onChange={(e) => set({ mode: e.target.checked ? "auto" : "manual" })}
            />
            {auto && (
              <FormField label={t("integrations:policies.frequency")}>
                {(f) => (
                  <Combobox
                    {...f}
                    aria-label={t("integrations:policies.frequencyOf", { type: name })}
                    value={p.frequency}
                    disabled={patch.isPending}
                    onChange={(v) => set({ frequency: v as SyncFrequency })}
                    options={options(FREQUENCIES)}
                  />
                )}
              </FormField>
            )}
            {auto && <ScheduleAt policy={p} name={name} disabled={patch.isPending} set={set} />}
          </div>
          {/* Empty (null) = all three; picking all three again goes back to it. */}
          <fieldset>
            <legend className="mb-1 font-medium">{t("integrations:policies.alert")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ALERT_SEVERITIES.map((s) => (
                <label key={s} className="flex min-h-9 items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={t("integrations:policies.alertOf", {
                      severity: t(SEVERITY[s]),
                      type: name,
                    })}
                    checked={picked(s)}
                    disabled={patch.isPending}
                    onChange={() => {
                      const next = ALERT_SEVERITIES.filter((x) =>
                        x === s ? !picked(s) : picked(x),
                      );
                      set({
                        alertSeverities: next.length === ALERT_SEVERITIES.length ? null : next,
                      });
                    }}
                  />
                  {t(SEVERITY[s])}
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        {/* Prints never change once imported: nothing to choose. */}
        {review && !prints && (
          <div className="grid gap-3 @xl:grid-cols-2">
            <FormField label={t("integrations:policies.scope")} hint={t(SCOPE_HINTS[p.scope])}>
              {(f) => (
                <Combobox
                  {...f}
                  aria-label={t("integrations:policies.scopeOf", { type: name })}
                  value={p.scope}
                  disabled={patch.isPending}
                  onChange={(v) => set({ scope: v as SyncScope })}
                  options={options(SCOPES)}
                />
              )}
            </FormField>
            <FormField label={t("integrations:policies.merge")} hint={t(MERGE_HINTS[p.merge])}>
              {(f) => (
                <Combobox
                  {...f}
                  aria-label={t("integrations:policies.mergeOf", { type: name })}
                  value={p.merge}
                  disabled={patch.isPending}
                  onChange={(v) => set({ merge: v as SyncMerge })}
                  options={options(MERGES)}
                />
              )}
            </FormField>
          </div>
        )}
        {prints && (
          <div className="grid gap-3 @xl:grid-cols-2">
            <FormField label={t("integrations:sync.range")} hint={t("integrations:sync.rangeHint")}>
              {(f) => (
                <Combobox
                  {...f}
                  value={range}
                  onChange={(v) => setRange(v as keyof typeof RANGES)}
                  options={options(RANGES)}
                />
              )}
            </FormField>
            {range === "custom" && (
              <div className="grid grid-cols-2 gap-3 @xl:col-start-1">
                <FormField label={t("integrations:sync.from")}>
                  {(f) => (
                    <DateInput
                      {...f}
                      className={inputClass}
                      value={from}
                      max={to || undefined}
                      onChange={setFrom}
                    />
                  )}
                </FormField>
                <FormField label={t("integrations:sync.to")}>
                  {(f) => (
                    <DateInput
                      {...f}
                      className={inputClass}
                      value={to}
                      min={from || undefined}
                      onChange={setTo}
                    />
                  )}
                </FormField>
              </div>
            )}
          </div>
        )}
        {/* Runs without a review (scheduled, "sync now"); a review asks on its own. */}
        {(prints || type === "spools") && (
          <div>
            <label className="flex min-h-9 items-center gap-2 font-medium">
              <input
                type="checkbox"
                aria-describedby={trackHint}
                checked={p.trackUsage}
                disabled={patch.isPending}
                onChange={(e) => set({ trackUsage: e.target.checked })}
              />
              {t("integrations:policies.trackUsage")}
            </label>
            <p id={trackHint} className="text-muted">
              {type === "spools"
                ? t("integrations:policies.trackUsageSpools")
                : t("integrations:policies.trackUsageOf", { type: name })}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * When an `auto` type runs within its frequency, in the server's time zone. "Any time" (a cleared
 * time) unsets them all: every frequency since the last run, as before.
 */
function ScheduleAt({
  policy: p,
  name,
  disabled,
  set,
}: {
  policy: SyncPolicy;
  name: string;
  disabled: boolean;
  set: (change: Partial<At>) => void;
}) {
  const { t, i18n } = useTranslation();
  const fields = AT_FIELDS[p.frequency];
  const clear = Object.fromEntries(fields.map((f) => [f, null]));
  const hint = t("integrations:policies.at.hint");
  const of = (field: string) => t("integrations:policies.at.of", { field, type: name });

  if (p.frequency === "1d") {
    const label = t("integrations:policies.at.time");
    const value =
      p.atHour == null && p.atMinute == null ? "" : `${pad(p.atHour ?? 0)}:${pad(p.atMinute ?? 0)}`;
    return (
      <FormField label={label} hint={hint}>
        {(f) => (
          <input
            {...f}
            type="time"
            aria-label={of(label)}
            className={inputClass}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              set(e.target.value ? { atHour: h, atMinute: m } : clear);
            }}
          />
        )}
      </FormField>
    );
  }

  const weekday = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "long" });
  const choices: Record<keyof At, { value: number; label: string }[]> = {
    // 15m: the offset within each quarter of an hour.
    atMinute: Array.from({ length: p.frequency === "15m" ? 15 : 60 }, (_, m) => ({
      value: m,
      label: `:${pad(m)}`,
    })),
    atHour: Array.from({ length: 24 }, (_, h) => ({
      value: h,
      label: formatTime(new Date(2000, 0, 1, h)),
    })),
    // 2 Jan 2000 was a Sunday.
    atWeekday: WEEKDAYS.map((d) => ({ value: d, label: weekday.format(new Date(2000, 0, 2 + d)) })),
    atDay: Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: formatNumber(i + 1) })),
  };
  return fields.map((field, i) => {
    const label = t(AT_LABELS[field]);
    const v = p[field];
    return (
      <FormField key={field} label={label} hint={i === fields.length - 1 ? hint : undefined}>
        {(f) => (
          <Combobox
            {...f}
            aria-label={of(label)}
            value={v == null ? "" : String(p.frequency === "15m" ? v % 15 : v)}
            disabled={disabled}
            onChange={(next) => set(next ? { [field]: Number(next) } : clear)}
            options={[
              { value: "", label: t("integrations:policies.at.any") },
              ...choices[field].map((c) => ({ value: String(c.value), label: c.label })),
            ]}
          />
        )}
      </FormField>
    );
  });
}
