import {
  externalPrinterSchema,
  externalPrintSchema,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type SyncRun,
  type SyncTrigger,
  type TestResult,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { HttpError } from "../errors.ts";
import { secretStore } from "./secrets.ts";

const { alerts, integrations, printers, prints, printFilamentUsages, syncRuns } = schema;

// ponytail: re-fetch a 7-day window so prints that finished after the last run aren't missed;
// insert-only dedupe makes the overlap free. Widen if a vendor reports later than that.
const OVERLAP_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 5 * 60 * 1000;
const KEEP_RUNS = 100;

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
          const res = db
            .insert(printers)
            .values({ ...p.data, ...imported })
            .onConflictDoNothing()
            .run();
          if (res.changes) created++;
          else skipped++;
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
                })
                .onConflictDoNothing()
                .returning({ id: prints.id })
                .get();
              if (!inserted) {
                skipped++;
                continue;
              }
              created++;
              // ponytail: spool/profile unknown here; Step 13 matches material + colour to a profile.
              if (filaments.length)
                tx.insert(printFilamentUsages)
                  .values(
                    filaments.map((f) => ({
                      printId: inserted.id,
                      grams: f.grams,
                      slot: f.slot ?? null,
                    })),
                  )
                  .run();
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
        .values({ kind: "sync_failed", entityType: "integration", entityId: id })
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

  /** Scheduled job: every enabled integration, one after another. */
  async function runAll() {
    const rows = db
      .select({ id: integrations.id })
      .from(integrations)
      .where(eq(integrations.enabled, true))
      .all();
    for (const { id } of rows) {
      // A manual run in progress (409) or a deleted row is fine to skip; failures are already stored.
      await run(id, "scheduled").catch(() => {});
    }
  }

  return { run, runAll, test, running, adapters };
}

export type Syncer = ReturnType<typeof createSyncer>;
