import {
  externalPrinterSchema,
  externalPrintSchema,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type LibrarySpool,
  librarySpoolSchema,
  matchSpool,
  type SyncRun,
  type SyncTrigger,
  type TestResult,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { HttpError } from "../errors.ts";
import { modelIdFor } from "../lib/catalog.ts";
import { takeFromSpool } from "../lib/spools.ts";
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
const KEEP_RUNS = 100;
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
    return row;
  };

  const instanceFor = (row: ReturnType<typeof rowOf>, signal: AbortSignal) => {
    const adapter = adapters.find((a) => a.id === row.adapterId);
    // The adapter is gone (e.g. the mock flag is off): report it like any other failure.
    if (!adapter) throw new IntegrationError("unknown");
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

  async function run(id: string, trigger: SyncTrigger): Promise<SyncRun> {
    const row = rowOf(id);
    if (running.has(id)) throw new HttpError(409, "sync_running", "A sync is already running");
    running.add(id);
    const startedAt = new Date().toISOString();
    let created = 0;
    let skipped = 0;
    let errorCode: IntegrationErrorCode | null = null;
    const runLog = log.child({ integrationId: id });
    try {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const instance = instanceFor(row, signal);
      const imported = { origin: "integration" as const, integrationId: id };

      if (instance.printers) {
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

      if (instance.printHistory) {
        const printerIds = new Map(
          db
            .select({ id: printers.id, externalId: printers.externalId })
            .from(printers)
            .where(eq(printers.integrationId, id))
            .all()
            .map((p) => [p.externalId, p.id]),
        );
        const since = row.lastSyncAt
          ? new Date(Date.parse(row.lastSyncAt) - OVERLAP_MS).toISOString()
          : undefined;
        let cursor: string | undefined;
        do {
          signal.throwIfAborted(); // also stops an adapter that never ends its cursor
          const page = await instance.printHistory.listPrints({ since, cursor });
          db.transaction((tx) => {
            for (const raw of page.items) {
              const p = externalPrintSchema.safeParse(raw);
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
                      material: filamentProfiles.material,
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
        .set({ status: "ok", lastSyncAt: startedAt, lastError: null })
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
      errorCode = codeOf(e);
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
          context: { name: row.name },
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

  /** Scheduled job: every enabled integration, one after another (see NEEDS_USER / BACK_OFF). */
  async function runAll() {
    const rows = db
      .select({ id: integrations.id, lastError: integrations.lastError })
      .from(integrations)
      .where(eq(integrations.enabled, true))
      .all();
    for (const { id, lastError } of rows) {
      if (lastError && NEEDS_USER.has(lastError)) continue;
      if (lastError && BACK_OFF.has(lastError)) {
        const last = db
          .select({ startedAt: syncRuns.startedAt })
          .from(syncRuns)
          .where(eq(syncRuns.integrationId, id))
          .orderBy(desc(syncRuns.startedAt))
          .get();
        if (last && Date.now() - Date.parse(last.startedAt) < BACK_OFF_MS) continue;
      }
      // A manual run in progress (409) or a deleted row is fine to skip; failures are already stored.
      await run(id, "scheduled").catch(() => {});
    }
  }

  /** Spools of every integration that keeps them, read live; ids become `<adapterId>:<id>`. */
  async function listSpools(): Promise<LibrarySpool[]> {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const sources = db
      .select()
      .from(integrations)
      .all()
      .filter((row) => adapters.some((a) => a.id === row.adapterId))
      .map((row) => ({ row, source: instanceFor(row, signal).spools }))
      .filter((s) => !!s.source);
    if (!sources.length)
      throw new HttpError(404, "no_spool_source", "No integration keeps a spool inventory");
    const out: LibrarySpool[] = [];
    for (const { row, source } of sources) {
      try {
        for (const s of (await source?.listSpools()) ?? [])
          out.push(librarySpoolSchema.parse({ ...s, spoolId: `${row.adapterId}:${s.spoolId}` }));
      } catch (e) {
        throw new HttpError(502, codeOf(e), "Couldn't read the spools");
      }
    }
    return out;
  }

  return { run, runAll, test, listSpools, running, adapters };
}

export type Syncer = ReturnType<typeof createSyncer>;
