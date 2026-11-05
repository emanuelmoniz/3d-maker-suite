import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  autoDecisions,
  defaultPolicy,
  type ExternalPrint,
  type ExternalPrinter,
  externalPrinterSchema,
  externalPrintSchema,
  type ImportApplyDecision,
  type ImportGone,
  type ImportPreviewRow,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type IntegrationInstance,
  isAction,
  isUserPresetType,
  type LibrarySpool,
  librarySpoolSchema,
  type MergePolicy,
  matchPrint,
  REVIEWED_TYPES,
  type ReviewedType,
  SLICER_PRESET_TYPES,
  type SyncFrequency,
  type SyncLogEntry,
  type SyncPolicy,
  type SyncRequest,
  type SyncResult,
  type SyncRun,
  type SyncTrigger,
  type SyncType,
  type TestResult,
  USER_PRESET_ENTITY,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { presetFileName } from "@3d-maker-suite/host";
import { Cron } from "croner";
import { and, asc, desc, eq, isNull, like, notInArray, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { raise } from "../alerts/evaluate.ts";
import { HttpError } from "../errors.ts";
import { freedRows, goneRows, isPresetKind, PRESET_KINDS } from "../import/gone.ts";
import { createReview, type Stored, untracked } from "../import/review.ts";
import type { Rights } from "../lib/auth.ts";
import { clearDeleted } from "../lib/catalog.ts";
import { deleteItem } from "../lib/dependents.ts";
import { success } from "../lib/logSink.ts";
import { readPreferences } from "../lib/preferences.ts";
import { bookOrLink } from "../lib/prints.ts";
import { linkPrints } from "../projects/linkPrints.ts";
import {
  activeCapabilities,
  capableRow,
  catalogDir,
  policyOf,
  raisesSeverity,
  slicerCatalogType,
  slicerConfigDir,
  slicerFileType,
  switchedOn,
} from "./capabilities.ts";
import { deleteCloudCopy, fetchCloudPresets, placeCloudPresets } from "./cloudPresets.ts";
import { libraryOf } from "./imports.ts";
import { linkLibraries } from "./managedSlicer.ts";
import { mergeUserPresets, userPresetFiles } from "./presetLibrary.ts";
import { ownRows, releaseRoute } from "./presetRoutes.ts";
import { secretStore } from "./secrets.ts";
import {
  activeSpools,
  type LibraryType,
  libraryRows,
  printerRows,
  printRows,
  spoolHistory,
  spoolRows,
} from "./sourceRows.ts";

const {
  deletedSources,
  importSnapshots,
  integrations,
  prints,
  printFilamentUsages,
  syncPolicies,
  syncRuns,
} = schema;

/** The dates a prints read is limited to; none = since the last run. */
type Range = { from?: string; to?: string };

/** A confirmed review: the rows it showed and what the user decided for them. */
export type Pick = {
  stored: Stored;
  decisions: ImportApplyDecision[];
  policy: MergePolicy;
  /** The backup taken before the confirm. */
  backup: string;
};

const REVIEWED = new Set<string>(REVIEWED_TYPES);
// ponytail: re-fetch a 7-day window so prints that finished after the last run aren't missed;
// insert-only dedupe makes the overlap free. Widen if a vendor reports later than that.
const OVERLAP_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 5 * 60 * 1000;
const KEEP_RUNS = 200;
// Lines per run log; the rest is counted in one `truncated` line (ADR-0008).
const MAX_LOG = 200;
// ponytail: a row's name for the log is its title or name column; per-entity labels if one shows blank.
const labelOf = (v: Record<string, unknown>) => {
  // A spool has no name of its own: its filament and colour ("Bambu PLA Silk Green").
  const spool = [v.profile, v.colorName ?? v.colorHex].filter(Boolean).join(" ");
  const s = String(v.title ?? v.name ?? v.model ?? spool);
  return s ? { label: s } : {};
};
/** A row waiting for a person, for a run's log. */
const leftEntry = (r: ImportPreviewRow): SyncLogEntry => ({
  event: "left",
  ...labelOf(r.values),
  reason: Object.values(r.refs ?? {}).some((v) => !v)
    ? "pick"
    : r.refsUnsure?.length
      ? "unsure"
      : "review",
});
/** A catalog row whose preset is gone from the slicer, for a run's log. */
const goneEntry = (g: { label: string }): SyncLogEntry => ({
  event: "left",
  label: g.label,
  reason: "removed",
});
/** Gone rows in use: asked again once free (`checkFreed`). */
const inUse = (gone: ImportGone[]) => gone.filter((g) => g.dependents.length).map((g) => g.id);
// The scheduler ticks every minute (main.ts). An `auto` type with a time set runs at its
// `schedulePattern`; without one, when its frequency has passed since the last run.
// ponytail: "1M" is 30 days, not a calendar month.
const FREQUENCY_MS: Record<SyncFrequency, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 3600 * 1000,
  "1d": 24 * 3600 * 1000,
  "1w": 7 * 24 * 3600 * 1000,
  "1M": 30 * 24 * 3600 * 1000,
};
// Cron fires a little after its slot, so a run isn't "early" by a few seconds of jitter.
const DUE_SLACK_MS = 60 * 1000;
// Scheduled runs skip errors only the user can fix, and back off after rate limits / blocks.
const NEEDS_USER = new Set(["auth_required", "auth_expired", "login_failed", "code_invalid"]);
const BACK_OFF = new Set(["rate_limited", "blocked"]);
// ponytail: fixed 1 h pause after a rate limit; make it exponential if vendors keep throttling.
const BACK_OFF_MS = 3600 * 1000;
// Any other failure is retried after this, not on every tick.
const RETRY_MS = 15 * 60 * 1000;

// Not `Pick<>`: this file's `Pick` is a confirmed review.
type At = { [K in "atMinute" | "atHour" | "atWeekday" | "atDay"]: SyncPolicy[K] };

/**
 * The croner pattern (server local time) an `auto` type runs at, or null when none of the fields
 * its frequency uses is set. A missing one is minute 0, hour 0, Monday, the 1st.
 */
export function schedulePattern(frequency: SyncFrequency, at: At): string | null {
  const { atMinute: m, atHour: h, atWeekday: wd, atDay: d } = at;
  const [used, pattern] =
    frequency === "15m"
      ? [[m], `${(m ?? 0) % 15}/15 * * * *`]
      : frequency === "1h"
        ? [[m], `${m ?? 0} * * * *`]
        : frequency === "1d"
          ? [[h, m], `${m ?? 0} ${h ?? 0} * * *`]
          : frequency === "1w"
            ? [[wd, h], `0 ${h ?? 0} * * ${wd ?? 1}`]
            : [[d, h], `0 ${h ?? 0} ${d ?? 1} * *`];
  return used.some((v) => v != null) ? pattern : null;
}

/** Is a type due: never ran, its next slot after the last run has come, or (no time set) its frequency has passed. */
function isDue(p: At & { frequency: SyncFrequency; lastRunAt: string | null }, now = Date.now()) {
  if (!p.lastRunAt) return true;
  const pattern = schedulePattern(p.frequency, p);
  if (!pattern) return now - Date.parse(p.lastRunAt) >= FREQUENCY_MS[p.frequency] - DUE_SLACK_MS;
  const next = new Cron(pattern).nextRun(p.lastRunAt);
  return !!next && next.getTime() <= now;
}

/**
 * Runs adapters and stores what they return, through the review. Which rows a run takes and what
 * it does with a change to a row you have follow the type's `scope` and `merge`; prints are
 * insert-only.
 */
export function createSyncer(
  db: Db,
  adapters: IntegrationAdapter[],
  key: Buffer,
  log: FastifyBaseLogger,
  /** Where model thumbnails are copied to; empty (tests) = none. */
  dataDir = "",
) {
  const running = new Set<string>();
  const review = createReview(db, dataDir);

  const rowOf = (id: string) => {
    const row = db.select().from(integrations).where(eq(integrations.id, id)).get();
    if (!row) throw new HttpError(404, "not_found", "Integration not found");
    // Disabled = switched off entirely: no sync, no test, no capabilities.
    if (!row.enabled) throw new HttpError(409, "integration_disabled", "Integration is disabled");
    return row;
  };

  const adapterOf = (row: ReturnType<typeof rowOf>) => {
    const adapter = adapters.find((a) => a.id === row.adapterId);
    // The adapter is gone (e.g. the mock flag is off): report it like any other failure.
    if (!adapter) throw new IntegrationError("unknown");
    return adapter;
  };

  const instanceFor = (row: ReturnType<typeof rowOf>, signal: AbortSignal) => {
    const adapter = adapterOf(row);
    if (!adapter.create) throw new HttpError(409, "capability_unavailable", "No account to reach");
    return adapter.create({
      config: adapter.configSchema.parse(row.config),
      secrets: secretStore(db, key, row.id),
      log: log.child({ integrationId: row.id, adapterId: row.adapterId }),
      signal,
    });
  };

  const codeOf = (e: unknown): IntegrationErrorCode =>
    e instanceof IntegrationError ? e.code : "unknown";

  async function test(id: string): Promise<TestResult> {
    try {
      return await instanceFor(rowOf(id), AbortSignal.timeout(TIMEOUT_MS)).test();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      return { ok: false, code: codeOf(e) };
    }
  }

  /**
   * One run syncs one type. A `from`/`to` range (prints only) re-reads that window instead of
   * continuing from the cursor, and never moves it. Reviewed types apply what `pick` decided, or
   * without one only the rows that need no decision; the rest is counted as pending. Prints are
   * reviewed too: one whose filament matches no single spool waits for a person.
   */
  async function run(
    id: string,
    trigger: SyncTrigger,
    req: SyncRequest,
    pick?: Pick,
  ): Promise<SyncResult> {
    const row = rowOf(id);
    const { type } = req;
    const adapter = adapters.find((a) => a.id === row.adapterId);
    if (!(adapter && switchedOn(db, row, adapter, type)))
      throw new HttpError(409, "capability_unavailable", `Integration doesn't sync "${type}"`);
    if (running.has(id)) throw new HttpError(409, "sync_running", "A sync is already running");
    running.add(id);
    const startedAt = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let pending = 0;
    // A slicer's presets gone from it: set by a run nobody confirmed (ADR-0019).
    let gone: ImportGone[] | undefined;
    let oldestLeft: string | undefined;
    let errorCode: IntegrationErrorCode | null = null;
    const runLog = log.child({ integrationId: id });
    // What the run did, for its alert. Codes and row names only; raw errors go to `runLog`.
    const lines: SyncLogEntry[] = [];
    let cut = 0;
    const note = (e: SyncLogEntry) => (lines.length < MAX_LOG ? lines.push(e) : cut++);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      // Only an account has an instance; a local source is read from its folder.
      const instance = adapter.create && instanceFor(row, signal);
      const ranged = !!(req.from || req.to);
      // An account's user presets: copied for slicing, and gone ones counted like a slicer's.
      const cloud =
        isUserPresetType(type) && instance?.userPresets
          ? { type, library: instance.userPresets.library }
          : undefined;

      if (REVIEWED.has(type)) {
        const offer = async () => {
          const rows = await offered(row, type as ReviewedType, instance, req, signal);
          // A run with nobody watching follows the policy; a confirmed review decided already.
          return policyOf(db, id, type).trackUsage ? rows : untracked(rows);
        };
        const stored = pick?.stored ?? (await offer());
        if (cloud) await placeCloudPresets(db, dataDir, adapters, row, cloud, note);
        // A run with nobody watching writes changes the way the type's `merge` says; under
        // `review` it writes none (they wait), so the policy only matters for new rows.
        const done = review.write(
          stored,
          pick?.decisions ?? autoDecisions(review.preview(stored).rows),
          pick?.policy ??
            (policyOf(db, id, type).merge === "keepEdits" ? "keepEdits" : "overwrite"),
          pick?.backup ?? null,
        );
        ({ created, updated, pending } = done);
        for (const w of done.written) note({ event: w.event, ...labelOf(w.values) });
        for (const r of done.invalid) note({ event: "invalid", ...labelOf(r.values) });
        for (const r of done.left) note(leftEntry(r));
        // The sync log counts what was there already; rows left for review are not "skipped".
        skipped = Math.max(0, done.skipped - pending);
        // The next run starts at the oldest print left for review, so it is offered again.
        oldestLeft = done.left
          .map((r) => String(r.values.startedAt))
          .reduce<string | undefined>((a, b) => (a && a < b ? a : b), undefined);
        // No run follows until the slicer's files change: what a review left out stays out, or its
        // alert would never close.
        if (pick && slicerFileType(adapter, type)) pending = 0;
        // Never deleted by a run: each waits for a person, whatever the card's mode.
        if (!pick && (slicerFileType(adapter, type) || cloud)) {
          gone = goneRows(db, review, stored);
          pending += gone.length;
          for (const g of gone) note(goneEntry(g));
        }
      }

      if (type === "prints") {
        rematch();
        linkPrints(db);
      }

      // Only a sync (scheduled or "Sync now") of prints without a range moves the cursor on. A
      // past-range run must not make the next one skip prints, and a confirmed review is an import,
      // not a sync: a print skipped there still comes in with the next sync. Any run moves it back
      // to a print it left for review, so the next run and "since the last sync" offer it again.
      const was = policyOf(db, id, "prints").cursor;
      const cursor =
        type !== "prints"
          ? null
          : !ranged && !pick
            ? (oldestLeft ?? startedAt)
            : was && oldestLeft && Date.parse(oldestLeft) < Date.parse(was)
              ? oldestLeft
              : null;
      const done = {
        pending,
        ...(!pick && { lastRunAt: startedAt }),
        ...(cursor && { cursor }),
        ...(gone && { goneInUse: inUse(gone) }),
      };
      db.insert(syncPolicies)
        .values({ integrationId: id, type, ...defaultPolicy(type), ...done })
        .onConflictDoUpdate({ target: [syncPolicies.integrationId, syncPolicies.type], set: done })
        .run();
      db.update(integrations)
        .set({ status: "ok", lastSyncAt: startedAt, lastError: null })
        .where(eq(integrations.id, id))
        .run();
    } catch (e) {
      // Not set up (e.g. no slicer folder) is the caller's problem, not a failed run.
      if (e instanceof HttpError) throw e;
      // A run cut off by the timeout is a slow vendor, whatever the interrupted call threw.
      errorCode = signal.aborted ? "unreachable" : codeOf(e);
      // Only the code is stored; the raw error (possibly a vendor message) goes to the local log.
      runLog.warn({ err: e, code: errorCode }, "sync failed");
      note({ event: "failed", code: errorCode });
      db.update(integrations)
        .set({ status: "error", lastError: errorCode })
        .where(eq(integrations.id, id))
        .run();
    } finally {
      running.delete(id);
    }

    const previous = db
      .select({ status: syncRuns.status })
      .from(syncRuns)
      .where(and(eq(syncRuns.integrationId, id), eq(syncRuns.type, type)))
      .orderBy(desc(syncRuns.startedAt))
      .get();
    const saved = db
      .insert(syncRuns)
      .values({
        integrationId: id,
        trigger,
        type,
        rangeFrom: req.from ?? null,
        rangeTo: req.to ?? null,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: errorCode ? "error" : "ok",
        errorCode,
        created,
        skipped,
        log: cut ? [...lines, { event: "truncated", count: cut }] : lines,
      })
      .returning()
      .get();
    if (!errorCode) {
      success(runLog, { type, trigger, created, skipped }, "sync done");
      // The sync works again: its open error alerts leave everyone's list (another type's stay).
      const now = new Date().toISOString();
      db.update(schema.alerts)
        .set({ resolvedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.alerts.kind, "sync_error"),
            eq(schema.alerts.task, `sync:${id}:${type}`),
            isNull(schema.alerts.resolvedAt),
          ),
        )
        .run();
    }
    // A sync's result is an alert; a confirmed review (`pick`) isn't, the person is looking at it.
    // A type that keeps failing alerts once, until a run goes through again.
    const severity = errorCode ? "error" : "success";
    if (!pick && raisesSeverity(policyOf(db, id, type), severity)) {
      const about = { integrationId: id, adapterId: row.adapterId, type };
      const context = errorCode
        ? previous?.status !== "error" && { ...about, code: errorCode }
        : created + updated > 0 && { ...about, created, updated };
      if (context)
        raise(db, {
          kind: errorCode ? "sync_error" : "sync_success",
          severity,
          module: "integrations",
          task: `sync:${id}:${type}`,
          entityType: "sync_run",
          entityId: saved.id,
          context,
          // A copy: runs get pruned, the alert stays until dismissed.
          detail: { runId: saved.id, log: saved.log },
        });
    }
    const keep = db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(eq(syncRuns.integrationId, id))
      .orderBy(desc(syncRuns.startedAt))
      .limit(KEEP_RUNS);
    db.delete(syncRuns)
      .where(and(eq(syncRuns.integrationId, id), notInArray(syncRuns.id, keep)))
      .run();
    return { ...(saved as SyncRun), updated, pending };
  }

  /**
   * Scheduled job: in every enabled integration, each set-up type in `auto` mode whose frequency
   * has passed since its last successful run, one after another (see NEEDS_USER / BACK_OFF). What a
   * slicer's files feed has no schedule: see `checkCatalogs` and `checkUserPresets`.
   */
  async function runAll() {
    const rows = db.select().from(integrations).where(eq(integrations.enabled, true)).all();
    for (const row of rows) {
      const { id, lastError } = row;
      if (lastError && NEEDS_USER.has(lastError)) continue;
      if (lastError) {
        const latest = db
          .select({ startedAt: syncRuns.startedAt })
          .from(syncRuns)
          .where(eq(syncRuns.integrationId, id))
          .orderBy(desc(syncRuns.startedAt))
          .get();
        const wait = BACK_OFF.has(lastError) ? BACK_OFF_MS : RETRY_MS;
        if (latest && Date.now() - Date.parse(latest.startedAt) < wait) continue;
      }
      const adapter = adapters.find((a) => a.id === row.adapterId);
      // Adapter order: printers come before the prints that point at them.
      for (const type of activeCapabilities(db, row, adapter)) {
        if (isAction(type) || slicerFileType(adapter, type)) continue;
        const p = policyOf(db, id, type);
        // A failed run leaves `lastRunAt` alone, so it is retried after RETRY_MS.
        if (p.mode !== "auto" || !isDue(p)) continue;
        // A manual run in progress (409) or a deleted row is fine to skip; failures are already stored.
        const done = await run(id, "scheduled", { type }).catch(() => null);
        // The vendor is failing: leave this integration's other types for a later tick.
        if (done?.errorCode) break;
      }
    }
  }

  /**
   * Rows wait for a person: their count, and the run that names them. In a transaction with what
   * marks the change as seen, or the alert would be lost for good.
   */
  function holdForReview(
    integrationId: string,
    type: SyncType,
    rows: ImportPreviewRow[],
    gone: ImportGone[],
    at: string,
  ) {
    const set = { pending: rows.length + gone.length, goneInUse: inUse(gone) };
    db.insert(syncPolicies)
      .values({ integrationId, type, ...defaultPolicy(type), ...set })
      .onConflictDoUpdate({ target: [syncPolicies.integrationId, syncPolicies.type], set })
      .run();
    logLeft(integrationId, type, [...rows.map(leftEntry), ...gone.map(goneEntry)], at);
  }

  /** A run that only names rows left for a person, so the alert's detail lists them. */
  function logLeft(integrationId: string, type: SyncType, left: SyncLogEntry[], at: string) {
    if (!left.length) return;
    // The alert's detail comes from the latest run: without this, an older run's rows.
    const cut = left.length - MAX_LOG;
    db.insert(syncRuns)
      .values({
        integrationId,
        trigger: "scheduled",
        type,
        startedAt: at,
        finishedAt: at,
        status: "ok",
        log: [
          ...left.slice(0, MAX_LOG),
          ...(cut > 0 ? [{ event: "truncated" as const, count: cut }] : []),
        ],
      })
      .run();
  }

  /**
   * On the scheduler's tick and after a managed install (ADR-0019), when a slicer's system presets
   * changed: an `auto` type runs. A `manual` type imported from it before writes nothing and counts
   * what waits for a person, and `sync_pending` leads to the review. The first sight of a folder is
   * only recorded, and a type never imported stays silent: someone who only slices has nothing to
   * review.
   */
  async function checkCatalogs() {
    const libraries = new Set<string>();
    const rows = db.select().from(integrations).orderBy(asc(integrations.createdAt)).all();
    for (const row of rows) {
      const adapter = adapters.find((a) => a.id === row.adapterId);
      const lib = adapter?.library;
      const dir = adapter && slicerConfigDir(row, adapter);
      const types = activeCapabilities(db, row, adapter).filter((t): t is LibraryType =>
        slicerCatalogType(adapter, t),
      );
      // A library's catalog belongs to its oldest row with a readable folder.
      if (!lib || !dir || !types.length || libraries.has(lib.id)) continue;
      libraries.add(lib.id);
      if (running.has(row.id)) continue;
      try {
        const now = await lib.catalogFingerprint?.(dir);
        if (!now || now === row.catalogFingerprint) continue;
        const seenBefore = row.catalogFingerprint ? types : [];
        const manual = seenBefore.filter((t) => policyOf(db, row.id, t).mode !== "auto");
        let failed = false;
        const waiting: { type: LibraryType; left: ImportPreviewRow[]; gone: ImportGone[] }[] = [];
        for (const type of seenBefore.filter((t) => !manual.includes(t))) {
          const stored = await offered(row, type);
          // Nothing to do logs nothing: the sync log only shows real changes. A preset gone from
          // the slicer only waits.
          if (!review.preview(stored).rows.some((r) => r.auto))
            waiting.push({ type, left: [], gone: goneRows(db, review, stored) });
          else if ((await run(row.id, "scheduled", { type })).errorCode) failed = true;
        }
        // The fingerprint stays, so the next check tries again.
        if (failed) continue;
        const imported = new Set(
          db
            .select({ entity: importSnapshots.entity })
            .from(importSnapshots)
            .where(eq(importSnapshots.integrationId, row.id))
            .all()
            .map((s) => s.entity),
        );
        for (const type of manual) {
          if (!imported.has(type)) continue;
          // ponytail: every new system row of a partly imported type counts, wanted or not; the
          // brand pick narrows it.
          const stored: Stored = {
            entity: type,
            ignoredHeaders: [],
            from: { kind: "integration", integrationId: row.id },
            dir,
            rows: await libraryRows(lib, dir, type, { dataDir, scope: "system" }),
          };
          const { rows: read } = review.preview(stored);
          const gone = goneRows(db, review, stored);
          // A user preset's row marks its type imported too: none of these rows being yours, the
          // system presets never were. Unless the update took every one away.
          const yours = read.some((r) => r.targetId);
          if (!yours && !gone.length) continue;
          waiting.push({ type, left: yours ? read.filter((r) => r.auto) : [], gone });
        }
        const at = new Date().toISOString();
        db.transaction(() => {
          for (const { type, left, gone } of waiting) holdForReview(row.id, type, left, gone, at);
          db.update(integrations)
            .set({ catalogFingerprint: now })
            .where(eq(integrations.id, row.id))
            .run();
        });
      } catch (err) {
        // The fingerprint stays, so the next check tries again.
        log.warn({ err, integrationId: row.id }, "catalog check failed");
      }
    }
  }

  /**
   * A preset you deleted from the catalog is wanted again once it's edited (ADR-0019). ponytail: by
   * file time, so a slicer rewriting a file with no edit brings the row back too, and it can be
   * deleted again. Comparing content would need the sha kept with the mark.
   */
  function clearEdited(library: string, files: ReturnType<typeof userPresetFiles>) {
    const prefix = `${library}:user/`;
    const marks = db
      .select()
      .from(deletedSources)
      .where(like(deletedSources.source, `${prefix}%`))
      .all();
    for (const m of marks) {
      const name = presetFileName(m.source.slice(prefix.length));
      const kind = isPresetKind(m.entity) && PRESET_KINDS[m.entity];
      const file = files.find((f) => f.kind === kind && f.file === name);
      if (file && file.mtimeMs > Date.parse(m.deletedAt)) clearDeleted(db, m.entity, m.source);
    }
  }

  /**
   * Each slicer folder's user presets, per kind, follow their card when a file changes (ADR-0019):
   * `auto` runs it, and what needs a person waits; `manual` writes nothing and everything waits. Only
   * the files' times and sizes are looked at until one changes, so it can run every minute. What was
   * last seen is the type's `cursor`.
   */
  async function scanUserPresets() {
    const hub = !!dataDir && readPreferences(db).hubEnabled;
    if (hub) linkLibraries(db, dataDir, adapters);
    const folders = new Set<string>();
    // Oldest first, and a row with its own folder first: of the rows sharing the hub's library, one
    // that can read the system presets resolves the parents.
    const rows = db
      .select()
      .from(integrations)
      .orderBy(asc(integrations.createdAt))
      .all()
      .sort((a, b) => Number(!a.slicerConfigDir) - Number(!b.slicerConfigDir));
    // The libraries a hub's managed slicer reads into the catalog: a route of their own.
    const readLibrary = new Set(
      rows.flatMap((row) => {
        const adapter = adapters.find((a) => a.id === row.adapterId);
        return hub &&
          adapter?.managed &&
          adapter.library &&
          activeCapabilities(db, row, adapter).some(isUserPresetType)
          ? [adapter.library.id]
          : [];
      }),
    );
    for (const row of rows) {
      const adapter = adapters.find((a) => a.id === row.adapterId);
      const lib = adapter?.library;
      const dir = adapter && catalogDir(db, dataDir, row, adapter);
      const types = activeCapabilities(db, row, adapter).filter(isUserPresetType);
      if (!lib || !dir || !types.length || running.has(row.id)) continue;
      const user = join(dir, "user");
      if (!existsSync(user)) continue;
      const folder = realpathSync(user);
      if (folders.has(folder)) continue;
      folders.add(folder);
      try {
        const files = userPresetFiles(user);
        const filesOf = (type: (typeof types)[number]) =>
          files.filter((f) => f.kind === PRESET_KINDS[USER_PRESET_ENTITY[type]]);
        const cursorOf = (type: (typeof types)[number]) =>
          filesOf(type)
            .map((f) => `${f.path}:${f.mtimeMs}:${f.size}`)
            .sort()
            .join(";");
        const seeAt = (type: (typeof types)[number], now: string) =>
          db
            .update(syncPolicies)
            .set({ cursor: now })
            .where(and(eq(syncPolicies.integrationId, row.id), eq(syncPolicies.type, type)))
            .run();
        // A hub PC's own slicer shares into the library, with no owner (ADR-0019). Where a managed
        // slicer reads the library, that is these presets' one route: one review, count and alert.
        if (hub && !adapter?.managed) {
          const due = types.filter((t) => cursorOf(t) !== (policyOf(db, row.id, t).cursor ?? ""));
          // The library's own check sees the change at the latest on the next tick.
          if (due.length) mergeUserPresets(db, dataDir, lib.id, user);
          if (readLibrary.has(lib.id)) {
            for (const t of due) seeAt(t, cursorOf(t));
            continue;
          }
        }
        for (const type of types) {
          const mine = filesOf(type);
          const now = cursorOf(type);
          const policy = policyOf(db, row.id, type);
          if (now === (policy.cursor ?? "")) continue;
          clearEdited(lib.id, mine);
          const stored = await offered(row, type);
          const left = review.preview(stored).rows.filter((r) => r.auto);
          const see = () => seeAt(type, now);
          // Nothing to do logs nothing: the sync log only shows real changes. A preset gone from
          // the slicer only waits.
          if (policy.mode === "auto" && left.length) {
            // A failed run keeps the cursor, so the next check tries again.
            if (!(await run(row.id, "scheduled", { type })).errorCode) see();
          } else {
            const gone = goneRows(db, review, stored);
            db.transaction(() => {
              holdForReview(row.id, type, left, gone, new Date().toISOString());
              see();
            });
          }
        }
      } catch (err) {
        // The cursor stays, so the next check tries again.
        log.warn({ err, integrationId: row.id }, "user presets check failed");
      }
    }
  }

  // One at a time: the scheduler's tick and a hub's saved preset can overlap.
  let userPresetsCheck = Promise.resolve();
  const checkUserPresets = () =>
    (userPresetsCheck = userPresetsCheck
      .then(scanUserPresets)
      .catch((err) => log.warn({ err }, "user presets check failed")));

  /**
   * On the scheduler's tick: a row gone from its slicer that was in use waits for a person again once
   * nothing uses it (ADR-0019). Only if nothing of its type waits: then it's counted already, or its
   * alert was ignored, and that doesn't ask again until the slicer's files change.
   */
  function checkFreed() {
    const held = db
      .select()
      .from(syncPolicies)
      .where(sql`json_array_length(${syncPolicies.goneInUse}) > 0`)
      .all();
    for (const p of held) {
      const entity = isUserPresetType(p.type) ? USER_PRESET_ENTITY[p.type] : p.type;
      if (!isPresetKind(entity)) continue;
      const row = db.select().from(integrations).where(eq(integrations.id, p.integrationId)).get();
      const adapter = adapters.find((a) => a.id === row?.adapterId);
      const dir = row && adapter ? catalogDir(db, dataDir, row, adapter) : null;
      const { still, free } = freedRows(db, entity, p.goneInUse, dir);
      const at = new Date().toISOString();
      const ask = !p.pending && free.length > 0;
      db.transaction(() => {
        db.update(syncPolicies)
          .set({ goneInUse: still, ...(ask && { pending: free.length }) })
          .where(
            and(eq(syncPolicies.integrationId, p.integrationId), eq(syncPolicies.type, p.type)),
          )
          .run();
        if (ask)
          logLeft(
            p.integrationId,
            p.type as SyncType,
            free.map((label) => goneEntry({ label })),
            at,
          );
      });
    }
  }

  /**
   * A person's Delete in the review of a row gone from its slicer (ADR-0019): read the slicer again,
   * and only a row still gone and free goes. One with your edits is archived instead, so the typed
   * value isn't lost. The caller takes the backup.
   */
  async function deleteGone(id: string, type: ReviewedType, rowId: string, user?: Rights) {
    const stored = await offer(id, type);
    const gone = goneRows(db, review, stored, user).find((g) => g.id === rowId);
    if (!gone || !isPresetKind(stored.entity))
      throw new HttpError(404, "not_found", "No row of a preset gone from the slicer");
    if (gone.dependents.length)
      throw new HttpError(409, "in_use", "Still used by other records", {
        dependents: gone.dependents,
      });
    const t = schema[stored.entity] as typeof schema.machineProfiles;
    const source = db.select({ s: t.sourcePreset }).from(t).where(eq(t.id, rowId)).get()?.s;
    if (gone.edited)
      db.update(t).set({ archivedAt: new Date().toISOString() }).where(eq(t.id, rowId)).run();
    else deleteItem(db, stored.entity, rowId, { user, dataDir });
    if (source) {
      releaseRoute(db, stored.entity, source);
      // An account's preset: its copy for slicing goes with the row, held or not.
      const row = rowOf(id);
      const [, library, name] = /^([^:]*):user\/(.+)$/.exec(source) ?? [];
      const cloud = adapters.find((a) => a.id === row.adapterId)?.kind === "cloud";
      if (cloud && isUserPresetType(type) && library && name)
        deleteCloudCopy(db, dataDir, adapters, row, type, library, name);
    }
    // ponytail: one less waiting, whatever it was counted for; the next change in the slicer's
    // files counts afresh.
    const p = policyOf(db, id, type);
    db.update(syncPolicies)
      .set({
        pending: Math.max(p.pending - 1, 0),
        goneInUse: p.goneInUse.filter((g) => g !== rowId),
      })
      .where(and(eq(syncPolicies.integrationId, id), eq(syncPolicies.type, type)))
      .run();
    return { result: gone.edited ? ("archived" as const) : ("deleted" as const) };
  }

  /** The printers of one integration's account, read live; invalid ones are logged and left out. */
  async function readPrinters(id: string, instance: IntegrationInstance) {
    const out: ExternalPrinter[] = [];
    for (const raw of (await instance.printers?.listPrinters()) ?? []) {
      const p = externalPrinterSchema.safeParse(raw);
      if (p.success) out.push(p.data);
      else log.warn({ integrationId: id, issues: p.error.issues }, "invalid printer from adapter");
    }
    return out;
  }

  /** The spools one integration keeps, read live; ids become `<adapterId>:<id>`. */
  const readSpools = async (
    row: ReturnType<typeof rowOf>,
    instance: IntegrationInstance,
  ): Promise<LibrarySpool[]> =>
    ((await instance.spools?.listSpools()) ?? []).map((s) =>
      librarySpoolSchema.parse({ ...s, spoolId: `${row.adapterId}:${s.spoolId}` }),
    );

  /**
   * The vendor's prints in the range, or since the last run (minus an overlap) without one.
   * A review without a range reads the whole history but keeps only prints never imported (left
   * for review, skipped, or missed): nothing already done shows up again. A review with a range
   * shows every print in it, imported or not.
   * A print already imported only gets a plate that was never known, and its model's name for a
   * title that is still the print profile's.
   */
  async function readPrints(
    id: string,
    instance: IntegrationInstance,
    range: Range,
    signal: AbortSignal,
    review = false,
  ): Promise<ExternalPrint[]> {
    if (!instance.printHistory) return [];
    const last = policyOf(db, id, "prints").cursor;
    const since =
      range.from || range.to
        ? range.from
        : last && !review
          ? new Date(Date.parse(last) - OVERLAP_MS).toISOString()
          : undefined;
    // ponytail: a review pages through the whole history; fine for a person's print count.
    const until = range.to;
    const out: ExternalPrint[] = [];
    let cursor: string | undefined;
    do {
      signal.throwIfAborted();
      const page = await instance.printHistory.listPrints({ since, until, cursor });
      // An adapter stuck on one page would re-read it until the timeout; stop at once instead.
      if (page.nextCursor && page.nextCursor === cursor) throw new IntegrationError("api_changed");
      for (const raw of page.items) {
        const p = externalPrintSchema.safeParse(raw);
        if (!p.success) {
          log.warn({ integrationId: id, issues: p.error.issues }, "invalid print from adapter");
          continue;
        }
        // The adapter's `until` is only a hint to stop early; the range is enforced here.
        if ((until && p.data.startedAt > until) || (since && p.data.startedAt < since)) continue;
        out.push(p.data);
      }
      cursor = page.nextCursor;
    } while (cursor);
    // ponytail: a write while reading, but idempotent and only ever filling a blank or replacing
    // the vendor's own old title.
    for (const p of out) {
      const same = and(eq(prints.integrationId, id), eq(prints.externalId, p.externalId));
      if (p.plate)
        db.update(prints)
          .set({ plate: p.plate })
          .where(and(same, isNull(prints.plate)))
          .run();
      // Imported when the title was the profile's name; one the user renamed stays theirs.
      if (p.profileTitle)
        db.update(prints)
          .set({ title: p.title })
          .where(and(same, eq(prints.title, p.profileTitle)))
          .run();
    }
    if (!review || range.from || range.to) return out;
    const imported = new Set(
      db
        .select({ externalId: prints.externalId })
        .from(prints)
        .where(eq(prints.integrationId, id))
        .all()
        .map((p) => p.externalId),
    );
    return out.filter((p) => !imported.has(p.externalId));
  }

  /**
   * Slots an earlier run left for the review queue get their spool once `matchPrint` is sure of
   * one; a guess among several stays for a person.
   */
  function rematch() {
    // Copies: the weights follow the bookings below.
    const active = activeSpools(db).map((s) => ({ ...s }));
    const byId = new Map(active.map((s) => [s.id, s]));
    const history = spoolHistory(db);
    const waiting = db
      .select({
        usage: printFilamentUsages,
        title: prints.title,
        startedAt: prints.startedAt,
        printerId: prints.printerId,
      })
      .from(printFilamentUsages)
      .innerJoin(prints, eq(prints.id, printFilamentUsages.printId))
      .where(and(isNull(printFilamentUsages.spoolId), eq(printFilamentUsages.dismissed, false)))
      // Oldest first, so a print follows the spools picked for the ones before it.
      .orderBy(prints.startedAt, printFilamentUsages.slot)
      .all();
    const byPrint = new Map<string, typeof waiting>();
    for (const w of waiting)
      byPrint.set(w.usage.printId, [...(byPrint.get(w.usage.printId) ?? []), w]);
    db.transaction((tx) => {
      for (const rows of byPrint.values()) {
        const first = rows[0];
        if (!first) continue;
        const { title, startedAt, printerId } = first;
        const slots = rows.map(({ usage: u }) => ({
          material: u.material ?? undefined,
          colorHex: u.colorHex ?? undefined,
          grams: u.grams,
          slot: u.slot,
          startedAt,
        }));
        const matches = matchPrint(slots, active, (slot) =>
          history.before(printerId, slot, startedAt),
        );
        for (const [i, { usage: u }] of rows.entries()) {
          const m = matches[i];
          const spool = m?.sure ? byId.get(m.id ?? "") : undefined;
          const profileId = spool && bookOrLink(tx, spool, u.grams, title, startedAt);
          if (!spool || !profileId) continue;
          if (spool.remainingGrams != null) spool.remainingGrams -= u.grams;
          tx.update(printFilamentUsages)
            .set({ spoolId: spool.id, profileId })
            .where(eq(printFilamentUsages.id, u.id))
            .run();
          history.add({ printerId, slot: u.slot, startedAt, spoolId: spool.id });
        }
      }
    });
  }

  /** What one reviewed type of an integration offers right now, as rows for the review. */
  async function offered(
    row: ReturnType<typeof rowOf>,
    type: ReviewedType,
    instance?: IntegrationInstance,
    range: Range = {},
    signal = AbortSignal.timeout(TIMEOUT_MS),
    review = false,
  ): Promise<Stored> {
    const from = { kind: "integration" as const, integrationId: row.id };
    if (type === "printers") {
      const items = instance ? await readPrinters(row.id, instance) : [];
      return { entity: type, ignoredHeaders: [], from, rows: printerRows(db, row.id, items) };
    }
    if (type === "spools") {
      const policy = policyOf(db, row.id, "spools");
      const rows = spoolRows(db, instance ? await readSpools(row, instance) : [], policy);
      return { entity: type, ignoredHeaders: [], from, rows };
    }
    if (type === "prints") {
      const items = instance ? await readPrints(row.id, instance, range, signal, review) : [];
      const rows = printRows(db, row.id, items);
      const kept = range.from || range.to ? { from: range.from, to: range.to } : undefined;
      return { entity: type, ignoredHeaders: [], from, rows, range: kept };
    }
    if (isUserPresetType(type)) {
      const entity = USER_PRESET_ENTITY[type];
      // An account's presets are read into a folder of their own; a slicer's are its folder's.
      const cloud = instance?.userPresets;
      const { lib, dir } = cloud
        ? await fetchCloudPresets(db, dataDir, adapters, row, type, cloud)
        : libraryOf(db, adapters, row.id, type, dataDir);
      const read = await libraryRows(lib, dir, entity, { dataDir, scope: "user" });
      // One route per preset (ADR-0019): an account takes the ones it lists.
      const rows = ownRows(db, row.id, entity, read, { take: !!cloud });
      return { entity, type, ignoredHeaders: [], from, dir, rows };
    }
    const { lib, dir } = libraryOf(db, adapters, row.id, type, dataDir);
    // Catalog rows read both: a user preset's brand is one to pick too.
    const scope = (SLICER_PRESET_TYPES as readonly string[]).includes(type) ? "system" : undefined;
    const rows = await libraryRows(lib, dir, type, { dataDir, scope });
    return { entity: type, ignoredHeaders: [], from, dir, rows };
  }

  /** For the review: a vendor failure comes back as a 502 with its code. */
  async function offer(id: string, type: ReviewedType, range: Range = {}): Promise<Stored> {
    const { row, adapter } = capableRow(db, adapters, id, type);
    try {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const instance =
        type === "printers" ||
        type === "spools" ||
        type === "prints" ||
        (isUserPresetType(type) && adapter.kind === "cloud")
          ? instanceFor(row, signal)
          : undefined;
      return await offered(row, type, instance, range, signal, true);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, codeOf(e), "Couldn't read the source");
    }
  }

  /**
   * The card's brand pick: adds what the slicer offers for these printer and filament brands
   * (brands, models, machine and print profiles; filament brands, materials, filament profiles),
   * one manual run per type after the one `backup`. It only adds: rows you have change in the review.
   */
  async function importBrands(
    id: string,
    pick: { brands: string[]; filamentBrands: string[] },
    backup: string,
  ) {
    const row = rowOf(id);
    const adapter = adapterOf(row);
    const lower = (names: string[]) => new Set(names.map((n) => n.trim().toLowerCase()));
    const [printer, filament] = [lower(pick.brands), lower(pick.filamentBrands)];
    // The column that holds a row's brand; materials name none, so a filament pick takes them all.
    const types: [LibraryType, Set<string>, string | null][] = [
      ["brands", printer, "name"],
      ["printerModels", printer, "brand"],
      ["machineProfiles", printer, "brand"],
      ["printProfiles", printer, "brand"],
      ["filamentBrands", filament, "name"],
      ["filamentMaterials", filament, null],
      ["filamentProfiles", filament, "brand"],
    ];
    let created = 0;
    for (const [type, names, column] of types) {
      if (!names.size || !switchedOn(db, row, adapter, type)) continue;
      const all = await offered(row, type);
      // `picked`: past the type's `scope`, a pick is a decision whatever "only what I already have" says.
      const stored: Stored = {
        ...all,
        picked: true,
        rows: all.rows.filter(
          (r) =>
            !column ||
            names.has(
              String(r.raw[column] ?? "")
                .trim()
                .toLowerCase(),
            ),
        ),
      };
      const rows = review.preview(stored).rows.filter((r) => r.action === "create");
      const decisions = autoDecisions(rows.map((r) => ({ ...r, auto: "apply" as const })));
      if (!decisions.length) continue;
      const done = await run(
        id,
        "manual",
        { type },
        { stored, decisions, policy: "keepEdits", backup },
      );
      created += done.created;
    }
    return created;
  }

  return {
    run,
    runAll,
    checkCatalogs,
    checkUserPresets,
    checkFreed,
    deleteGone,
    importBrands,
    test,
    offer,
    running,
    adapters,
  };
}

export type Syncer = ReturnType<typeof createSyncer>;
