import {
  ALERT_SEVERITIES,
  type AlertSeverity,
  type Capability,
  type Integration,
  isAction,
  type NewSpoolField,
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
import { TimeInput } from "../../components/TimeInput.tsx";
import { cx } from "../../lib/cx.ts";
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
// The row's one-line schedule; `at` = with the time set.
const SUMMARY: Record<SyncFrequency, { every: string; at: string }> = {
  "15m": { every: "integrations:policies.summary.15m", at: "integrations:policies.summary.15mAt" },
  "1h": { every: "integrations:policies.summary.1h", at: "integrations:policies.summary.1hAt" },
  "1d": { every: "integrations:policies.summary.1d", at: "integrations:policies.summary.1dAt" },
  "1w": { every: "integrations:policies.summary.1w", at: "integrations:policies.summary.1wAt" },
  "1M": { every: "integrations:policies.summary.1M", at: "integrations:policies.summary.1MAt" },
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
// A new spool's weight and open date.
const NEW_WEIGHT: Record<NewSpoolField, string> = {
  import: "integrations:policies.newSpools.weights.import",
  unset: "integrations:policies.newSpools.weights.unset",
  review: "integrations:policies.newSpools.weights.review",
};
const NEW_OPENED_AT: Record<NewSpoolField, string> = {
  import: "integrations:policies.newSpools.openedAts.import",
  unset: "integrations:policies.newSpools.openedAts.unset",
  review: "integrations:policies.newSpools.openedAts.review",
};
const NEW_WEIGHT_HINTS: Record<NewSpoolField, string> = {
  import: "integrations:policies.newSpools.weightHints.import",
  unset: "integrations:policies.newSpools.weightHints.unset",
  review: "integrations:policies.newSpools.weightHints.review",
};
const NEW_OPENED_AT_HINTS: Record<NewSpoolField, string> = {
  import: "integrations:policies.newSpools.openedAtHints.import",
  unset: "integrations:policies.newSpools.openedAtHints.unset",
  review: "integrations:policies.newSpools.openedAtHints.review",
};
const GROUPS = {
  devices: "integrations:policies.groups.devices",
  catalog: "integrations:policies.groups.catalog",
};
const DEVICES: readonly Capability[] = ["printers", "prints", "spools"];
// Types whose rows are reviewed and confirmed. They can also run straight from here: a run
// imports the rows that need no decision (catalog rows, spools with one matching profile, presets
// whose brand and material exist) and leaves the rest pending for the review page.
const isReviewed = (c: Capability): c is ReviewedType =>
  (REVIEWED_TYPES as readonly string[]).includes(c);

type At = Pick<SyncPolicy, "atMinute" | "atHour" | "atWeekday" | "atDay">;
// The fields each frequency's time uses (the server's `schedulePattern`).
const AT_FIELDS: Record<SyncFrequency, (keyof At)[]> = {
  "15m": ["atMinute"],
  "1h": ["atMinute"],
  "1d": ["atHour", "atMinute"],
  "1w": ["atWeekday", "atHour"],
  "1M": ["atDay", "atHour"],
};
// Monday first; 0 is Sunday, as on the server.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const pad = (n: number) => String(n).padStart(2, "0");
// 2 Jan 2000 was a Sunday.
const weekdayName = (lang: string | undefined, d: number) =>
  new Intl.DateTimeFormat(lang, { weekday: "long" }).format(new Date(2000, 0, 2 + d));
const hourAt = (h: number | null, m = 0) => formatTime(new Date(2000, 0, 1, h ?? 0, m));

type Patch = ReturnType<typeof usePatchIntegration>;
type Sync = ReturnType<typeof useSyncIntegration>;

const startOfDay = (daysAgo: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

/**
 * The range for "Review and import period". Custom dates are local days. Since the last sync
 * (scheduled or "Sync now"); never synced = no range, everything not imported yet.
 */
function rangeFor(
  range: keyof typeof RANGES,
  from: string,
  to: string,
  lastRunAt: string | null,
): Partial<SyncRequest> {
  if (range === "sinceLast") return lastRunAt ? { from: lastRunAt } : {};
  if (range === "d7") return { from: startOfDay(7) };
  if (range === "d30") return { from: startOfDay(30) };
  if (range === "d90") return { from: startOfDay(90) };
  if (range === "year") return { from: new Date(new Date().getFullYear(), 0, 1).toISOString() };
  return {
    ...(from && { from: new Date(`${from}T00:00:00`).toISOString() }),
    ...(to && { to: new Date(`${to}T23:59:59.999`).toISOString() }),
  };
}

/** The data types an integration imports, in groups (devices & prints, catalog), one row each. */
export function Policies({ integration: i, sync }: { integration: Integration; sync: Sync }) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  const tracking = (type: string) =>
    i.policies.some((p) => p.type === type && p.mode !== "off" && p.trackUsage);
  const doubleTracking = tracking("prints") && tracking("spools");
  return (
    // The rows follow the card's width, not the screen's.
    <div className="@container grid gap-4">
      <p className="text-muted">{t("integrations:policies.hint")}</p>
      {patch.isError && (
        <p role="alert" className="text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}
      {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((g) => {
        const rows = i.policies.filter(
          (p) => !isAction(p.type) && (DEVICES.includes(p.type) ? "devices" : "catalog") === g,
        );
        if (!rows.length) return null;
        const id = `${i.id}-${g}`;
        return (
          <section key={g} aria-labelledby={id} className="grid gap-2">
            <h5 id={id} className="font-medium text-muted">
              {t(GROUPS[g])}
            </h5>
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
    </div>
  );
}

/** Slicer actions (open in the slicer, slice): just on or off. */
export function ActionSwitches({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  return i.policies
    .filter((p) => isAction(p.type))
    .map((p) => (
      <Switch
        key={p.type}
        label={t(CAPS[p.type])}
        checked={p.mode !== "off"}
        disabled={patch.isPending}
        onChange={(e) =>
          patch.mutate({
            policies: [{ type: p.type, mode: e.target.checked ? "manual" : "off" }],
          })
        }
      />
    ));
}

/** "Manual", "Auto, every day at 07:30", …, in the server's time zone. */
function useSummary(p: SyncPolicy) {
  const { t, i18n } = useTranslation();
  if (p.mode !== "auto") return t("integrations:policies.modes.manual");
  const set = AT_FIELDS[p.frequency].some((f) => p[f] != null);
  if (!set) return t(SUMMARY[p.frequency].every);
  return t(SUMMARY[p.frequency].at, {
    minute: pad((p.atMinute ?? 0) % (p.frequency === "15m" ? 15 : 60)),
    time: hourAt(p.atHour, p.frequency === "1d" ? (p.atMinute ?? 0) : 0),
    weekday: weekdayName(i18n.resolvedLanguage, p.atWeekday ?? 1),
    day: formatNumber(p.atDay ?? 1),
  });
}

/**
 * A data type: name, schedule and last sync, Sync now and Review and import. Its settings open
 * below: when it runs, what and how it imports, alerts, and for prints a period to review.
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
  const name = t(CAPS[p.type]);
  const summary = useSummary(p);
  const set = (change: Partial<Omit<SyncPolicy, "type" | "lastRunAt" | "pending">>) =>
    patch.mutate({ policies: [{ type: p.type, ...change }] });
  const options = (map: Record<string, string>) =>
    Object.entries(map).map(([value, key]) => ({ value, label: t(key) }));

  const type = p.type;
  // Actions are switches in the slicer part, not rows (`Policies` leaves them out).
  if (isAction(type)) return null;
  const prints = type === "prints";
  // Switched off or not set up (no sign-in, no folder): nothing to run.
  const active = i.capabilities.includes(type);
  const reviewOf = (dates: Partial<SyncRequest>) =>
    isReviewed(type)
      ? ({
          to: "/import/$source/$id/$type",
          params: { source: "integration", id: i.id, type },
          search: dates as never,
        } as const)
      : null;
  const review = reviewOf({});
  const run = () => {
    if (!review) return sync.mutate({ type });
    sync.mutate(
      { type: review.params.type },
      // Rows were left for a person: take them there, to those rows only.
      {
        onSuccess: (r) =>
          void (r.pending > 0 && navigate({ ...review, search: { waiting: "1" } as never })),
      },
    );
  };
  const picked = (s: AlertSeverity) => p.alertSeverities?.includes(s) ?? true;
  const trackHint = `${detailsId}-track`;
  const auto = p.mode === "auto";
  // A run left rows for a person: the row says so, in the same yellow as the alert.
  const waiting = !!review && active && p.pending > 0;

  return (
    <li>
      {/* Narrow: name and chevron on one line, the actions below. Wide: one line, chevron last. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          <p className="flex flex-wrap items-center gap-x-3 text-muted">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cx("size-2 shrink-0 rounded-full", auto ? "bg-ok" : "bg-border")}
              />
              {summary}
            </span>
            {p.lastRunAt ? (
              // ponytail: "5 min. ago" goes stale until the integration refetches; tick it if it matters.
              <time dateTime={p.lastRunAt} title={formatDateTime(p.lastRunAt)}>
                {t("integrations:card.lastSync", { date: formatRelative(p.lastRunAt) })}
              </time>
            ) : (
              <span>{t("integrations:card.never")}</span>
            )}
          </p>
        </div>
        <span className="order-last flex w-full flex-wrap items-center gap-2 @xl:order-0 @xl:w-auto">
          {waiting && (
            <span className="flex items-center gap-1 font-medium text-warn">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {t("integrations:policies.pending", { count: p.pending })}
            </span>
          )}
          {active && (
            <Button disabled={sync.isPending} onClick={() => run()}>
              {t("integrations:policies.syncNow")}
            </Button>
          )}
          {review && active && (
            <Link
              {...review}
              className={cx(
                "inline-flex h-9 items-center justify-center rounded-md border px-3 font-medium transition-colors",
                waiting
                  ? "border-warn bg-warn/15 text-warn hover:bg-warn/25"
                  : "border-border bg-surface hover:bg-surface-2",
              )}
            >
              {t("integrations:policies.importNow")}
            </Link>
          )}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={t("integrations:policies.detailsOf", { type: name })}
          onClick={() => setOpen(!open)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-surface-2 @xl:order-last"
        >
          <ChevronRight
            aria-hidden
            className={cx("size-4 transition-transform", open && "rotate-90")}
          />
        </button>
      </div>

      <div
        id={detailsId}
        hidden={!open}
        className="mx-3 mb-3 grid gap-5 rounded-md bg-surface-2 p-4 @2xl:grid-cols-2"
      >
        <div className="grid content-start gap-5">
          <fieldset className="grid gap-3">
            <legend className="mb-2 font-semibold">{t("integrations:policies.when")}</legend>
            <Switch
              label={t("integrations:policies.auto")}
              aria-label={t("integrations:policies.autoOf", { type: name })}
              checked={auto}
              disabled={patch.isPending}
              onChange={(e) => set({ mode: e.target.checked ? "auto" : "manual" })}
            />
            {auto ? (
              <div className="grid gap-3">
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
                <ScheduleAt policy={p} name={name} disabled={patch.isPending} set={set} />
                <p className="text-muted">{t("integrations:policies.at.hint")}</p>
              </div>
            ) : (
              <p className="text-muted">{t("integrations:policies.manualHint")}</p>
            )}
          </fieldset>
          {/* Empty (null) = all three; picking all three again goes back to it. */}
          <fieldset>
            <legend className="mb-2 font-semibold">{t("integrations:policies.alert")}</legend>
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
        </div>

        {/* Right column. Prints never change once imported: only whether they take the filament. */}
        {(review || type === "spools") && (
          <div className="grid content-start gap-5">
            <fieldset className="grid content-start gap-3">
              <legend className="mb-2 font-semibold">{t("integrations:policies.whatHow")}</legend>
              {review && !prints && (
                <>
                  <FormField
                    label={t("integrations:policies.scope")}
                    hint={t(SCOPE_HINTS[p.scope])}
                  >
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
                  <FormField
                    label={t("integrations:policies.merge")}
                    hint={t(MERGE_HINTS[p.merge])}
                  >
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
                </>
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
            </fieldset>

            {/* Spools the source brings in for the first time; one you have keeps its own. */}
            {type === "spools" && (
              <fieldset className="grid content-start gap-3">
                <legend className="font-semibold">
                  {t("integrations:policies.newSpools.title")}
                </legend>
                <p className="-mt-1 text-muted">{t("integrations:policies.newSpools.hint")}</p>
                <FormField
                  label={t("integrations:policies.newSpools.weight")}
                  hint={t(NEW_WEIGHT_HINTS[p.newWeight])}
                >
                  {(f) => (
                    <Combobox
                      {...f}
                      value={p.newWeight}
                      disabled={patch.isPending}
                      onChange={(v) => set({ newWeight: v as NewSpoolField })}
                      options={options(NEW_WEIGHT)}
                    />
                  )}
                </FormField>
                <FormField
                  label={t("integrations:policies.newSpools.openedAt")}
                  hint={t(NEW_OPENED_AT_HINTS[p.newOpenedAt])}
                >
                  {(f) => (
                    <Combobox
                      {...f}
                      value={p.newOpenedAt}
                      disabled={patch.isPending}
                      onChange={(v) => set({ newOpenedAt: v as NewSpoolField })}
                      options={options(NEW_OPENED_AT)}
                    />
                  )}
                </FormField>
              </fieldset>
            )}
          </div>
        )}

        {prints && active && (
          <ReviewPeriod
            lastRunAt={p.lastRunAt}
            open={(dates) => {
              const target = reviewOf(dates);
              if (target) navigate(target);
            }}
          />
        )}
      </div>
    </li>
  );
}

/** Prints only: review every print of a period, imported or not, apart from the saved settings. */
function ReviewPeriod({
  lastRunAt,
  open,
}: {
  lastRunAt: string | null;
  open: (dates: Partial<SyncRequest>) => void;
}) {
  const { t } = useTranslation();
  const [range, setRange] = useState<keyof typeof RANGES>("sinceLast");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const invalid = range === "custom" && (!from || (!!to && to < from));
  return (
    // The divider is on a wrapper: on the fieldset it would run through the legend.
    <div className="border-t border-border pt-4 @2xl:col-span-2">
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">{t("integrations:sync.period")}</legend>
        <p className="text-muted">{t("integrations:sync.periodHint")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full @xl:w-56">
            <FormField label={t("integrations:sync.range")}>
              {(f) => (
                <Combobox
                  {...f}
                  value={range}
                  onChange={(v) => setRange(v as keyof typeof RANGES)}
                  options={Object.entries(RANGES).map(([value, key]) => ({ value, label: t(key) }))}
                />
              )}
            </FormField>
          </div>
          {range === "custom" && (
            <div className="grid w-full grid-cols-2 gap-3 @xl:w-80">
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
          <Button disabled={invalid} onClick={() => open(rangeFor(range, from, to, lastRunAt))}>
            {t("integrations:sync.reviewPeriod")}
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

/**
 * When an `auto` type runs within its frequency, in the server's time zone. A cleared time
 * ("Any time") unsets them all: every frequency since the last run.
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
  const any = t("integrations:policies.at.any");
  const of = (field: string) => t("integrations:policies.at.of", { field, type: name });

  // Daily: one time; weekly / monthly: a day plus a whole hour, in the same picker.
  const time = (label: string, minutes: boolean) => (
    <FormField key="time" label={label}>
      {(f) => (
        <TimeInput
          {...f}
          aria-label={of(label)}
          minutes={minutes}
          emptyLabel={any}
          disabled={disabled}
          value={
            p.atHour == null && (!minutes || p.atMinute == null)
              ? null
              : { hour: p.atHour ?? 0, minute: minutes ? (p.atMinute ?? 0) : 0 }
          }
          onChange={(v) =>
            set(v ? { atHour: v.hour, ...(minutes && { atMinute: v.minute }) } : clear)
          }
        />
      )}
    </FormField>
  );
  const pick = (
    field: "atMinute" | "atWeekday" | "atDay",
    label: string,
    choices: { value: number; label: string }[],
  ) => {
    const v = p[field];
    // 15m: a minute kept from an hourly time is its offset within the quarter.
    const shown = v != null && field === "atMinute" && p.frequency === "15m" ? v % 15 : v;
    return (
      <FormField key={field} label={label}>
        {(f) => (
          <Combobox
            {...f}
            aria-label={of(label)}
            value={shown == null ? "" : String(shown)}
            disabled={disabled}
            onChange={(next) => set(next ? { [field]: Number(next) } : clear)}
            options={[
              { value: "", label: any },
              ...choices.map((c) => ({ value: String(c.value), label: c.label })),
            ]}
          />
        )}
      </FormField>
    );
  };

  if (p.frequency === "1d") return time(t("integrations:policies.at.time"), true);
  if (p.frequency === "1w")
    return [
      pick(
        "atWeekday",
        t("integrations:policies.at.weekday"),
        WEEKDAYS.map((d) => ({ value: d, label: weekdayName(i18n.resolvedLanguage, d) })),
      ),
      time(t("integrations:policies.at.hour"), false),
    ];
  if (p.frequency === "1M")
    return [
      pick(
        "atDay",
        t("integrations:policies.at.day"),
        Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: formatNumber(i + 1) })),
      ),
      time(t("integrations:policies.at.hour"), false),
    ];
  // 15m: the offset within each quarter of an hour.
  const label = t("integrations:policies.at.minute");
  const shown = p.atMinute == null ? null : p.atMinute % (p.frequency === "15m" ? 15 : 60);
  return (
    <FormField key="atMinute" label={label}>
      {(f) => (
        <TimeInput
          {...f}
          aria-label={of(label)}
          hours={false}
          minuteOptions={Array.from({ length: p.frequency === "15m" ? 15 : 60 }, (_, m) => m)}
          emptyLabel={any}
          disabled={disabled}
          value={shown == null ? null : { hour: 0, minute: shown }}
          onChange={(v) => set(v ? { atMinute: v.minute } : clear)}
        />
      )}
    </FormField>
  );
}
