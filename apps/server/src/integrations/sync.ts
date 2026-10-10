import {
  defaultPolicy,
  externalPrinterSchema,
  externalPrintSchema,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type IntegrationInstance,
  type LibrarySpool,
  librarySpoolSchema,
  matchSpool,
  SLICER_CATALOG_TYPES,
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
import { activeCapabilities, capableRow, policyOf, switchedOn } from "./capabilities.ts";
import { type CatalogType, catalogEntries, importCatalog } from "./catalogImport.ts";
import { importPresets, importSpools, libraryOf, readLibrary } from "./imports.ts";
import { secretStore } from "./secrets.ts";

const {
  alerts,
  filamentProfiles,
  integrations,
  printers,
  prints,
  printFilamentUsages,
  spools,
  syncPolicies,
  syncRuns,
} = schema;

/** The confirmed preview of a manual import: which rows to take (and onto what). */
export type Pick = {
  /** spoolId -> the filament profile it goes on. */
  spools?: Map<string, string>;
  presets?: { ids: Set<string>; includeSystem: boolean };
  /** Keys of the catalog rows (brands, models, machine profiles, filament brands) to take. */
  catalog?: Set<string>;
};

// ponytail: re-fetch a 7-day window so prints that finished after the last run aren't missed;
// insert-only dedupe makes the overlap free. Widen if a vendor reports later than that.
const CATALOG_TYPES = new Set<string>(SLICER_CATALOG_TYPES);
const OVERLAP_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 5 * 60 * 1000;
const KEEP_RUNS = 200;
// The scheduler ticks every 15 minutes (main.ts); an `auto` type runs when its frequency has passed.
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

/**
 * Runs adapters and stores what they return. Dedupe is insert-only on (integrationId, externalId):
 * a row that already exists is skipped, so local edits always win.
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
   * continuing from the cursor, and never moves it. Types with a preview import what `pick` names,
   * or without one only the rows that need no decision; the rest is counted as pending.
   */
  async function run(
    id: string,
    trigger: SyncTrigger,
    req: SyncRequest,
    pick: Pick = {},
  ): Promise<SyncRun> {
    const row = rowOf(id);
    const { type } = req;
    const adapter = adapters.find((a) => a.id === row.adapterId);
    if (!(adapter && switchedOn(db, row, adapter, type)))
      throw new HttpError(409, "capability_unavailable", `Integration doesn't sync "${type}"`);
    if (running.has(id)) throw new HttpError(409, "sync_running", "A sync is already running");
    running.add(id);
    const startedAt = new Date().toISOString();
    let created = 0;
    let skipped = 0;
    let pending = 0;
    let errorCode: IntegrationErrorCode | null = null;
    const runLog = log.child({ integrationId: id });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      // Only an account has an instance; a local source is read from its folder.
      const instance = adapter.create && instanceFor(row, signal);
      const ranged = !!(req.from || req.to);
      const imported = { origin: "integration" as const, integrationId: id };

      if (type === "spools") {
        const items = instance ? await readSpools(row, instance) : [];
        ({ created, skipped, pending } = importSpools(db, items, pick.spools));
      }
      if (CATALOG_TYPES.has(type)) {
        const { lib, dir } = libraryOf(db, adapters, id, type);
        const entries = await catalogEntries(db, lib, dir, type as CatalogType, dataDir);
        ({ created, skipped, pending } = importCatalog(db, entries, pick.catalog));
      }
      if (type === "filamentProfiles") {
        const { lib, presets } = await readLibrary(
          db,
          adapters,
          id,
          pick.presets?.includeSystem ?? false,
        );
        ({ created, skipped, pending } = importPresets(db, lib.id, presets, pick.presets?.ids));
      }

      if (type === "printers" && instance?.printers) {
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

      if (type === "prints" && instance?.printHistory) {
        const printerIds = new Map(
          db
            .select({ id: printers.id, externalId: printers.externalId })
            .from(printers)
            .where(eq(printers.integrationId, id))
            .all()
            .map((p) => [p.externalId, p.id]),
        );
        const from = policyOf(db, id, type).cursor;
        const since = ranged
          ? req.from
          : from
            ? new Date(Date.parse(from) - OVERLAP_MS).toISOString()
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

      // Only a prints run without a range moves the cursor (a past-range run must not make the
      // next one skip prints).
      const done = {
        lastRunAt: startedAt,
        pending,
        ...(type === "prints" && !ranged && { cursor: startedAt }),
      };
      db.insert(syncPolicies)
        .values({ integrationId: id, type, ...defaultPolicy(type), ...done })
        .onConflictDoUpdate({ target: [syncPolicies.integrationId, syncPolicies.type], set: done })
        .run();
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
      // Not set up (e.g. no slicer folder) is the caller's problem, not a failed run.
      if (e instanceof HttpError) throw e;
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
        type,
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
   * Scheduled job: in every enabled integration, each set-up type in `auto` mode whose frequency
   * has passed since its last successful run, one after another (see NEEDS_USER / BACK_OFF).
   */
  async function runAll() {
    const rows = db.select().from(integrations).where(eq(integrations.enabled, true)).all();
    for (const row of rows) {
      const { id, lastError } = row;
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
      const adapter = adapters.find((a) => a.id === row.adapterId);
      // Adapter order: printers come before the prints that point at them.
      for (const type of activeCapabilities(db, row, adapter)) {
        if (type === "openInSlicer") continue;
        const { mode, frequency, lastRunAt } = policyOf(db, id, type);
        // A failed run leaves `lastRunAt` alone, so it is retried on the next tick.
        if (
          mode !== "auto" ||
          (lastRunAt && Date.now() - Date.parse(lastRunAt) < FREQUENCY_MS[frequency] - DUE_SLACK_MS)
        )
          continue;
        // A manual run in progress (409) or a deleted row is fine to skip; failures are already stored.
        const done = await run(id, "scheduled", { type }).catch(() => null);
        // The vendor is failing: leave this integration's other types for a later tick.
        if (done?.errorCode) break;
      }
    }
  }

  /** The spools one integration keeps, read live; ids become `<adapterId>:<id>`. */
  const readSpools = async (
    row: ReturnType<typeof rowOf>,
    instance: IntegrationInstance,
  ): Promise<LibrarySpool[]> =>
    ((await instance.spools?.listSpools()) ?? []).map((s) =>
      librarySpoolSchema.parse({ ...s, spoolId: `${row.adapterId}:${s.spoolId}` }),
    );

  /** For the preview: a vendor failure comes back as a 502 with its code. */
  async function listSpools(integrationId: string): Promise<LibrarySpool[]> {
    const { row } = capableRow(db, adapters, integrationId, "spools");
    try {
      return await readSpools(row, instanceFor(row, AbortSignal.timeout(TIMEOUT_MS)));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, codeOf(e), "Couldn't read the spools");
    }
  }

  return { run, runAll, test, listSpools, running, adapters };
}

export type Syncer = ReturnType<typeof createSyncer>;
