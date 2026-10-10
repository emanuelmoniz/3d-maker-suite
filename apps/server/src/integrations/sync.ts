import {
  externalPrinterSchema,
  externalPrintSchema,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type LibrarySpool,
  librarySpoolSchema,
  matchSpool,
  type SyncFrequency,
  type SyncRequest,
  type SyncRun,
  type SyncTrigger,
  type TestResult,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { HttpError } from "../errors.ts";
import { modelIdFor, profileMaterial } from "../lib/catalog.ts";
import { takeFromSpool } from "../lib/spools.ts";
import { capableRow, switchedOn } from "./capabilities.ts";
import { secretStore } from "./secrets.ts";

const {
  alerts,
  filamentProfiles,
  integrations,
  printers,
  prints,
  printFilamentUsages,
  spools,
  syncRuns,
} = schema;

// ponytail: re-fetch a 7-day window so prints that finished after the last run aren't missed;
// insert-only dedupe makes the overlap free. Widen if a vendor reports later than that.
const OVERLAP_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 5 * 60 * 1000;
const KEEP_RUNS = 200;
// The scheduler ticks every 15 minutes (main.ts); an integration runs when its frequency has passed.
// ponytail: "1M" is 30 days, not a calendar month.
const FREQUENCY_MS: Record<Exclude<SyncFrequency, "off">, number> = {
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

/**
 * Runs adapters and stores what they return. Dedupe is insert-only on (integrationId, externalId):
 * a row that already exists is skipped, so local edits always win.
 */
export function createSyncer(
  db: Db,
  adapters: IntegrationAdapter[],
  key: Buffer,
  log: FastifyBaseLogger,
) {
  const running = new Set<string>();

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
   * `req.type` limits the run to one type (none = all). A `from`/`to` range (prints only) re-reads
   * that window instead of continuing from the last run; it never moves the incremental start.
   */
  async function run(id: string, trigger: SyncTrigger, req: SyncRequest = {}): Promise<SyncRun> {
    const row = rowOf(id);
    const known = adapters.find((a) => a.id === row.adapterId);
    if (req.type && !(known && switchedOn(row, known, req.type)))
      throw new HttpError(409, "capability_unavailable", `Integration doesn't sync "${req.type}"`);
    // A local source has nothing to sync; refuse before the run could be logged as a failure.
    if (known && !known.create)
      throw new HttpError(409, "capability_unavailable", "Integration has nothing to sync");
    if (running.has(id)) throw new HttpError(409, "sync_running", "A sync is already running");
    running.add(id);
    const startedAt = new Date().toISOString();
    let created = 0;
    let skipped = 0;
    let errorCode: IntegrationErrorCode | null = null;
    const runLog = log.child({ integrationId: id });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const instance = instanceFor(row, signal);
      const on = (cap: "printers" | "prints") =>
        (!req.type || req.type === cap) && switchedOn(row, adapterOf(row), cap);
      const ranged = !!(req.from || req.to);
      const incremental = !ranged && on("prints") && !!instance.printHistory;
      const imported = { origin: "integration" as const, integrationId: id };

      if (instance.printers && on("printers")) {
        for (const raw of await instance.printers.listPrinters()) {
          const p = externalPrinterSchema.safeParse(raw);
          if (!p.success) {
            skipped++;
            runLog.warn({ issues: p.error.issues }, "invalid printer from adapter");
            continue;
          }
          const known = db
            .select({ id: printers.id })
            .from(printers)
            .where(and(eq(printers.integrationId, id), eq(printers.externalId, p.data.externalId)))
            .get();
          if (known) {
            skipped++;
            continue;
          }
          // A printer added by hand (same serial) gets linked instead of imported twice.
          const twin =
            p.data.serial &&
            db
              .select({ id: printers.id })
              .from(printers)
              .where(
                and(
                  isNull(printers.integrationId),
                  sql`lower(${printers.serial}) = lower(${p.data.serial})`,
                ),
              )
              .get();
          if (twin)
            db.update(printers)
              .set({ integrationId: id, externalId: p.data.externalId })
              .where(eq(printers.id, twin.id))
              .run();
          else {
            const { brand, model, ...fields } = p.data;
            db.insert(printers)
              .values({ ...fields, modelId: modelIdFor(db, brand, model), ...imported })
              .run();
          }
          created++;
        }
      }

      if (instance.printHistory && on("prints")) {
        const printerIds = new Map(
          db
            .select({ id: printers.id, externalId: printers.externalId })
            .from(printers)
            .where(eq(printers.integrationId, id))
            .all()
            .map((p) => [p.externalId, p.id]),
        );
        const since = ranged
          ? req.from
          : row.lastPrintsSyncAt
            ? new Date(Date.parse(row.lastPrintsSyncAt) - OVERLAP_MS).toISOString()
            : undefined;
        const until = req.to;
        let cursor: string | undefined;
        do {
          signal.throwIfAborted();
          const page = await instance.printHistory.listPrints({ since, until, cursor });
          // An adapter stuck on one page would re-read it until the timeout; stop at once instead.
          if (page.nextCursor && page.nextCursor === cursor)
            throw new IntegrationError("api_changed");
          db.transaction((tx) => {
            for (const raw of page.items) {
              const p = externalPrintSchema.safeParse(raw);
              // The adapter's `until` is only a hint to stop early; the range is enforced here.
              if (
                p.success &&
                ((until && p.data.startedAt > until) || (since && p.data.startedAt < since))
              )
                continue;
              const printerId = p.success && printerIds.get(p.data.printerExternalId);
              if (!p.success || !printerId) {
                skipped++;
                runLog.warn(p.success ? { externalId: p.data.externalId } : {}, "print skipped");
                continue;
              }
              const { filaments, failureReason, ...d } = p.data;
              const inserted = tx
                .insert(prints)
                .values({
                  ...imported,
                  printerId,
                  externalId: d.externalId,
                  title: d.title,
                  startedAt: d.startedAt,
                  durationSec: d.durationSec,
                  outcome: d.outcome,
                  failureReason: d.outcome === "success" ? null : failureReason,
                  coverUrl: d.coverUrl,
                  sourceUrl: d.sourceUrl,
                })
                .onConflictDoNothing()
                .returning({ id: prints.id })
                .get();
              if (!inserted) {
                skipped++;
                continue;
              }
              created++;
              // A slot is booked from a spool only when matchSpool finds exactly one; anything else
              // stays unassigned (spoolId null) and shows up in the review queue.
              for (const f of filaments) {
                const spoolId = matchSpool(
                  { ...f, startedAt: d.startedAt },
                  tx
                    .select({
                      id: spools.id,
                      material: profileMaterial,
                      colorHex: spools.colorHex,
                      remainingGrams: spools.remainingGrams,
                      createdAt: spools.createdAt,
                    })
                    .from(spools)
                    .innerJoin(filamentProfiles, eq(filamentProfiles.id, spools.profileId))
                    .where(and(isNull(spools.archivedAt), ne(spools.status, "empty")))
                    .all(),
                );
                const profileId = spoolId ? takeFromSpool(tx, spoolId, f.grams, d.title) : null;
                tx.insert(printFilamentUsages)
                  .values({
                    printId: inserted.id,
                    spoolId: profileId ? spoolId : null,
                    profileId,
                    grams: f.grams,
                    slot: f.slot ?? null,
                    material: f.material,
                    colorHex: f.colorHex?.toLowerCase(),
                  })
                  .run();
              }
            }
          });
          cursor = page.nextCursor;
        } while (cursor);
      }

      db.update(integrations)
        .set({
          status: "ok",
          lastSyncAt: startedAt,
          // Only a prints run without a range moves the incremental start (a printers-only or
          // past-range run must not make the next one skip prints).
          ...(incremental && { lastPrintsSyncAt: startedAt }),
          lastError: null,
        })
        .where(eq(integrations.id, id))
        .run();
      db.update(alerts)
        .set({ resolvedAt: new Date().toISOString() })
        .where(
          and(
            eq(alerts.kind, "sync_failed"),
            eq(alerts.entityType, "integration"),
            eq(alerts.entityId, id),
            isNull(alerts.resolvedAt),
          ),
        )
        .run();
    } catch (e) {
      // A run cut off by the timeout is a slow vendor, whatever the interrupted call threw.
      errorCode = signal.aborted ? "unreachable" : codeOf(e);
      // Only the code is stored; the raw error (possibly a vendor message) goes to the local log.
      runLog.warn({ err: e, code: errorCode }, "sync failed");
      db.update(integrations)
        .set({ status: "error", lastError: errorCode })
        .where(eq(integrations.id, id))
        .run();
      db.insert(alerts)
        .values({
          kind: "sync_failed",
          entityType: "integration",
          entityId: id,
          context: { adapterId: row.adapterId }, // the web shows the adapter's name
        })
        .onConflictDoNothing()
        .run();
    } finally {
      running.delete(id);
    }

    const saved = db
      .insert(syncRuns)
      .values({
        integrationId: id,
        trigger,
        type: req.type ?? null,
        rangeFrom: req.from ?? null,
        rangeTo: req.to ?? null,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: errorCode ? "error" : "ok",
        errorCode,
        created,
        skipped,
      })
      .returning()
      .get();
    const keep = db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(eq(syncRuns.integrationId, id))
      .orderBy(desc(syncRuns.startedAt))
      .limit(KEEP_RUNS);
    db.delete(syncRuns)
      .where(and(eq(syncRuns.integrationId, id), notInArray(syncRuns.id, keep)))
      .run();
    return saved as SyncRun;
  }

  /**
   * Scheduled job: every enabled integration with something to sync, one after another
   * (see NEEDS_USER / BACK_OFF). A slicer-only one (cloud features off) is left alone.
   */
  async function runAll() {
    const rows = db
      .select()
      .from(integrations)
      .where(eq(integrations.enabled, true))
      .all()
      .filter((row) => {
        const adapter = adapters.find((a) => a.id === row.adapterId);
        return (
          !adapter || switchedOn(row, adapter, "printers") || switchedOn(row, adapter, "prints")
        );
      });
    for (const { id, lastError, syncFrequency } of rows) {
      if (syncFrequency === "off") continue;
      const last = db
        .select({ startedAt: syncRuns.startedAt })
        .from(syncRuns)
        .where(
          and(
            eq(syncRuns.integrationId, id),
            eq(syncRuns.trigger, "scheduled"),
            eq(syncRuns.status, "ok"),
          ),
        )
        .orderBy(desc(syncRuns.startedAt))
        .get();
      // Manual runs don't count (the schedule keeps its rhythm); a failed one is retried next tick.
      if (
        last &&
        Date.now() - Date.parse(last.startedAt) < FREQUENCY_MS[syncFrequency] - DUE_SLACK_MS
      )
        continue;
      if (lastError && NEEDS_USER.has(lastError)) continue;
      if (lastError && BACK_OFF.has(lastError)) {
        const latest = db
          .select({ startedAt: syncRuns.startedAt })
          .from(syncRuns)
          .where(eq(syncRuns.integrationId, id))
          .orderBy(desc(syncRuns.startedAt))
          .get();
        if (latest && Date.now() - Date.parse(latest.startedAt) < BACK_OFF_MS) continue;
      }
      // A manual run in progress (409) or a deleted row is fine to skip; failures are already stored.
      await run(id, "scheduled").catch(() => {});
    }
  }

  /** The spools one integration keeps, read live; ids become `<adapterId>:<id>`. */
  async function listSpools(integrationId: string): Promise<LibrarySpool[]> {
    const { row } = capableRow(db, adapters, integrationId, "spools");
    const source = instanceFor(row, AbortSignal.timeout(TIMEOUT_MS)).spools;
    if (!source) throw new HttpError(404, "capability_unavailable", "No spool inventory");
    try {
      return (await source.listSpools()).map((s) =>
        librarySpoolSchema.parse({ ...s, spoolId: `${row.adapterId}:${s.spoolId}` }),
      );
    } catch (e) {
      throw new HttpError(502, codeOf(e), "Couldn't read the spools");
    }
  }

  return { run, runAll, test, listSpools, running, adapters };
}

export type Syncer = ReturnType<typeof createSyncer>;
