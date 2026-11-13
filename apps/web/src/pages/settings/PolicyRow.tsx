import {
  type ACTIONS,
  ALERT_SEVERITIES,
  type AlertSeverity,
  type Capability,
  type Integration,
  isAction,
  isCatalogType,
  isUserPresetType,
  type NewSpoolField,
  REVIEWED_TYPES,
  type ReviewedType,
  type SyncFrequency,
  type SyncMerge,
  type SyncPolicy,
  type SyncRequest,
  type SyncScope,
} from "@3d-maker-suite/core";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Switch } from "../../components/Switch.tsx";
import { TimeInput } from "../../components/TimeInput.tsx";
import { useMe } from "../../lib/auth.ts";
import { formatDateTime, formatNumber, formatRelative, formatTime } from "../../lib/format.ts";
import {
  useMayTask,
  usePatchIntegration,
  type useSyncIntegration,
} from "../../lib/integrations.ts";
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
const USER_SCOPE_HINTS: Record<SyncScope, string> = {
  all: "integrations:policies.userScopeHints.all",
  imported: "integrations:policies.userScopeHints.imported",
};
const ACTION_HINTS: Record<(typeof ACTIONS)[number], string> = {
  slice: "integrations:actionHints.slice",
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
// Types whose rows are reviewed and confirmed. They can also run straight from here: a run
// imports the rows that need no decision (catalog rows, spools with one matching preset, presets,
// with the brand and material they need) and leaves the rest pending for the review page.
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

/** Slicer actions (open in the slicer, slice): just on or off. */
export function ActionSwitches({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  return i.policies.flatMap(({ type, mode }) =>
    isAction(type)
      ? [
          <div key={type} className="grid gap-1">
            <Switch
              label={t(CAPS[type])}
              checked={mode !== "off"}
              disabled={patch.isPending}
              onChange={(e) =>
                patch.mutate({
                  policies: [{ type, mode: e.target.checked ? "manual" : "off" }],
                })
              }
            />
            <p className="text-muted">{t(ACTION_HINTS[type])}</p>
          </div>,
        ]
      : [],
  );
}

/** "Off", "Manual", "Auto, every day at 07:30", …, in the server's time zone. */
export function useSummary(p: SyncPolicy, files: boolean) {
  const { t, i18n } = useTranslation();
  if (p.mode === "off") return t("integrations:policies.modes.off");
  // A slicer's line follows its files either way; Manual means its changes wait for review.
  if (p.mode !== "auto")
    return t(
      files ? "integrations:policies.onFileChangeReview" : "integrations:policies.modes.manual",
    );
  if (files) return t("integrations:policies.onFileChange");
  const set = AT_FIELDS[p.frequency].some((f) => p[f] != null);
  if (!set) return t(SUMMARY[p.frequency].every);
  return t(SUMMARY[p.frequency].at, {
    minute: pad((p.atMinute ?? 0) % (p.frequency === "15m" ? 15 : 60)),
    time: hourAt(p.atHour, p.frequency === "1d" ? (p.atMinute ?? 0) : 0),
    weekday: weekdayName(i18n.resolvedLanguage, p.atWeekday ?? 1),
    day: formatNumber(p.atDay ?? 1),
  });
}

/** What "What to sync" and "How to sync" say for a line (ADR-0021 wireframe 3). */
export const scopeLabel = (s: SyncScope) => SCOPES[s];
export const mergeLabel = (m: SyncMerge) => MERGES[m];

/**
 * A type's tasks: Sync now (which takes the user to the rows a run left for them) and Review and
 * import, each where the caller's rights and the integration allow it.
 */
export function useRunPolicy(i: Integration, p: SyncPolicy, sync: Sync) {
  const navigate = useNavigate();
  const may = useMayTask();
  const type = p.type;
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
  const canSync = active && may(i.id, type, "sync");
  const canReview = active && !!review && may(i.id, type, "review");
  const run = () => {
    // Actions (open in the slicer, slice) are switches, never run from here.
    if (isAction(type)) return;
    if (!review || !canReview) return sync.mutate({ type });
    sync.mutate(
      { type: review.params.type },
      // Rows were left for a person: take them there, to those rows only.
      {
        onSuccess: (r) =>
          void (r.pending > 0 && navigate({ ...review, search: { waiting: "1" } as never })),
      },
    );
  };
  return {
    active,
    review,
    reviewOf,
    canSync,
    canReview,
    run,
    // A run left rows for a person: the row says so, in the same yellow as the alert.
    waiting: !!review && active && p.pending > 0,
  };
}

type PolicyChange = Partial<Omit<SyncPolicy, "type" | "lastRunAt" | "pending">>;

/**
 * A type's settings: when it runs, alerts, editors, what and how it imports, new spools and usage.
 * `set` saves at once (a row's details) or edits a draft (the Edit dialog). `otherTracks`: the
 * same account's other type (prints, spools) also takes the filament.
 */
export function PolicyFields({
  integration: i,
  policy: p,
  set,
  disabled,
  otherTracks,
}: {
  integration: Integration;
  policy: SyncPolicy;
  set: (change: PolicyChange) => void;
  disabled: boolean;
  otherTracks?: boolean;
}) {
  const { t } = useTranslation();
  const detailsId = useId();
  const accounts = !!useMe();
  const name = t(CAPS[p.type]);
  // A slicer's cards read files: a change in them runs the type, so it has no schedule (ADR-0019).
  const files = i.kind !== "cloud";
  const options = (map: Record<string, string>) =>
    Object.entries(map).map(([value, key]) => ({ value, label: t(key) }));
  const type = p.type;
  const prints = type === "prints";
  const review = isReviewed(type);
  const picked = (s: AlertSeverity) => p.alertSeverities?.includes(s) ?? true;
  const trackHint = `${detailsId}-track`;
  const auto = p.mode === "auto";

  return (
    <>
      <div className="grid content-start gap-5">
        <fieldset className="grid gap-3">
          <legend className="mb-2 font-semibold">{t("integrations:policies.when")}</legend>
          <Switch
            label={t(files ? "integrations:policies.onFileChange" : "integrations:policies.auto")}
            aria-label={
              files
                ? t("integrations:policies.onFileChangeOf", { type: name })
                : t("integrations:policies.autoOf", { type: name })
            }
            checked={auto}
            disabled={disabled}
            onChange={(e) => set({ mode: e.target.checked ? "auto" : "manual" })}
          />
          {files ? (
            <p className="text-muted">
              {auto
                ? t("integrations:policies.onFileChangeHint")
                : t("integrations:policies.manualFilesHint")}
            </p>
          ) : auto ? (
            <Schedule
              schedule={p}
              name={name}
              disabled={disabled}
              set={set}
              hint={t("integrations:policies.at.hint")}
            />
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
                  disabled={disabled}
                  onChange={() => {
                    const next = ALERT_SEVERITIES.filter((x) => (x === s ? !picked(s) : picked(x)));
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
        {/* Without accounts there are no editors. */}
        {accounts && (
          <fieldset className="grid gap-1">
            <legend className="mb-2 font-semibold">
              {t("integrations:policies.editors.title")}
            </legend>
            <Switch
              label={t("integrations:policies.editors.sync")}
              aria-label={t("integrations:policies.editors.syncOf", { type: name })}
              checked={p.editorSync}
              disabled={disabled}
              onChange={(e) => set({ editorSync: e.target.checked })}
            />
            {review && (
              <Switch
                label={t("integrations:policies.editors.review")}
                aria-label={t("integrations:policies.editors.reviewOf", { type: name })}
                checked={p.editorReview}
                disabled={disabled}
                onChange={(e) => set({ editorReview: e.target.checked })}
              />
            )}
            <p className="text-muted">{t("integrations:policies.editors.hint")}</p>
          </fieldset>
        )}
      </div>

      {/* Right column. Prints never change once imported: only whether they take the filament. */}
      {review && (
        <div className="grid content-start gap-5">
          <fieldset className="grid content-start gap-3">
            <legend className="mb-2 font-semibold">{t("integrations:policies.whatHow")}</legend>
            {review && !prints && (
              <>
                <FormField
                  label={t("integrations:policies.scope")}
                  hint={t((isUserPresetType(type) ? USER_SCOPE_HINTS : SCOPE_HINTS)[p.scope])}
                >
                  {(f) => (
                    <Combobox
                      {...f}
                      aria-label={t("integrations:policies.scopeOf", { type: name })}
                      value={p.scope}
                      disabled={disabled}
                      onChange={(v) => set({ scope: v as SyncScope })}
                      options={options(SCOPES)}
                    />
                  )}
                </FormField>
                {/* A preset follows its file, a catalog row only fills (ADR-0020). */}
                {!isCatalogType(type) && (
                  <FormField
                    label={t("integrations:policies.merge")}
                    hint={t(MERGE_HINTS[p.merge])}
                  >
                    {(f) => (
                      <Combobox
                        {...f}
                        aria-label={t("integrations:policies.mergeOf", { type: name })}
                        value={p.merge}
                        disabled={disabled}
                        onChange={(v) => set({ merge: v as SyncMerge })}
                        options={options(MERGES)}
                      />
                    )}
                  </FormField>
                )}
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
                    disabled={disabled}
                    onChange={(e) => set({ trackUsage: e.target.checked })}
                  />
                  {t("integrations:policies.trackUsage")}
                </label>
                <p id={trackHint} className="text-muted">
                  {type === "spools"
                    ? t("integrations:policies.trackUsageSpools")
                    : t("integrations:policies.trackUsageOf", { type: name })}
                </p>
                {p.trackUsage && otherTracks && (
                  <p role="status" className="mt-1 text-warn">
                    {t("integrations:policies.doubleTracking")}
                  </p>
                )}
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
                    disabled={disabled}
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
                    disabled={disabled}
                    onChange={(v) => set({ newOpenedAt: v as NewSpoolField })}
                    options={options(NEW_OPENED_AT)}
                  />
                )}
              </FormField>
            </fieldset>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Edit on a Sources line (ADR-0021): the type's settings on a draft, saved together. Only what
 * changed is sent, so a line that is off stays off unless its schedule is changed.
 */
export function PolicyEditDialog({
  integration: i,
  policy,
  title,
  otherTracks,
  onClose,
}: {
  integration: Integration;
  policy: SyncPolicy;
  title: string;
  otherTracks?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  const [draft, setDraft] = useState(policy);
  const changed = Object.fromEntries(
    Object.entries(draft).filter(
      ([k, v]) =>
        JSON.stringify(v) !== JSON.stringify(policy[k as keyof SyncPolicy]) &&
        k !== "lastRunAt" &&
        k !== "pending",
    ),
  ) as PolicyChange;
  return (
    <FormDialog
      open
      title={title}
      busy={patch.isPending}
      error={patch.isError ? t("integrations:card.actionError") : undefined}
      onCancel={onClose}
      onSubmit={() => {
        if (!Object.keys(changed).length) return onClose();
        patch.mutate({ policies: [{ type: policy.type, ...changed }] }, { onSuccess: onClose });
      }}
    >
      <PolicyFields
        integration={i}
        policy={draft}
        set={(change) => setDraft((d) => ({ ...d, ...change }))}
        disabled={patch.isPending}
        otherTracks={otherTracks}
      />
    </FormDialog>
  );
}

/** "Last sync 5 min. ago", or "Never". */
export function LastSync({ at }: { at: string | null }) {
  const { t } = useTranslation();
  return at ? (
    // ponytail: "5 min. ago" goes stale until the integration refetches; tick it if it matters.
    <time dateTime={at} title={formatDateTime(at)}>
      {t("integrations:card.lastSync", { date: formatRelative(at) })}
    </time>
  ) : (
    <span>{t("integrations:card.never")}</span>
  );
}

/** Prints only: review every print of a period, imported or not, apart from the saved settings. */
export function ReviewPeriod({
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
    // In its own dialog, titled "Review a period".
    <div className="grid gap-3">
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
    </div>
  );
}

type Scheduled = At & { frequency: SyncFrequency };

/** A schedule's frequency and time: a sync type's, or a project folder's rescan. */
export function Schedule({
  schedule: p,
  name,
  disabled,
  set,
  hint,
}: {
  schedule: Scheduled;
  /** What runs, for the controls' labels. */
  name: string;
  disabled: boolean;
  set: (change: Partial<Scheduled>) => void;
  hint: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3">
      <FormField label={t("integrations:policies.frequency")}>
        {(f) => (
          <Combobox
            {...f}
            aria-label={t("integrations:policies.frequencyOf", { type: name })}
            value={p.frequency}
            disabled={disabled}
            onChange={(v) => set({ frequency: v as SyncFrequency })}
            options={Object.entries(FREQUENCIES).map(([value, key]) => ({ value, label: t(key) }))}
          />
        )}
      </FormField>
      <ScheduleAt policy={p} name={name} disabled={disabled} set={set} />
      <p className="text-muted">{hint}</p>
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
  policy: Scheduled;
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
