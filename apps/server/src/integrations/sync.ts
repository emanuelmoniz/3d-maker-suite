import {
  autoDecisions,
  defaultPolicy,
  type ExternalPrint,
  externalPrinterSchema,
  externalPrintSchema,
  type ImportApplyDecision,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type IntegrationInstance,
  type LibrarySpool,
  librarySpoolSchema,
  type MergePolicy,
  matchPrint,
  REVIEWED_TYPES,
  type ReviewedType,
  type SyncFrequency,
  type SyncRequest,
  type SyncResult,
  type SyncRun,
  type SyncTrigger,
  type TestResult,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { HttpError } from "../errors.ts";
import { createReview, type Stored, untracked } from "../import/review.ts";
import { modelIdFor } from "../lib/catalog.ts";
import { nextNumber } from "../lib/numbers.ts";
import { bookOrLink } from "../lib/prints.ts";
import { linkPrints } from "../projects/linkPrints.ts";
import { activeCapabilities, capableRow, policyOf, switchedOn } from "./capabilities.ts";
import { libraryOf } from "./imports.ts";
import { secretStore } from "./secrets.ts";
import { activeSpools, libraryRows, printRows, spoolHistory, spoolRows } from "./sourceRows.ts";

const { alerts, integrations, printers, prints, printFilamentUsages, syncPolicies, syncRuns } =
  schema;

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
    let oldestLeft: string | undefined;
    let errorCode: IntegrationErrorCode | null = null;
    const runLog = log.child({ integrationId: id });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      // Only an account has an instance; a local source is read from its folder.
      const instance = adapter.create && instanceFor(row, signal);
      const ranged = !!(req.from || req.to);
      const imported = { origin: "integration" as const, integrationId: id };

      if (REVIEWED.has(type)) {
        const offer = async () => {
          const rows = await offered(row, type as ReviewedType, false, instance, req, signal);
          // A run with nobody watching follows the policy; a confirmed review decided already.
          return policyOf(db, id, type).trackUsage ? rows : untracked(rows);
        };
        const stored = pick?.stored ?? (await offer());
        const done = review.write(
          stored,
          pick?.decisions ?? autoDecisions(review.preview(stored).rows),
          pick?.policy ?? "overwrite",
          pick?.backup ?? null,
        );
        ({ created, updated, pending } = done);
        // The sync log counts what was there already; rows left for review are not "skipped".
        skipped = Math.max(0, done.skipped - pending);
        // The next run starts at the oldest print left for review, so it is offered again.
        oldestLeft = done.left
          .map((r) => String(r.values.startedAt))
          .reduce<string | undefined>((a, b) => (a && a < b ? a : b), undefined);
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
              .values({
                ...fields,
                number: nextNumber(printers),
                modelId: modelIdFor(db, brand, model),
                ...imported,
              })
              .run();
          }
          created++;
        }
      }

      if (type === "prints") {
        rematch();
        linkPrints(db);
      }

      // Only a prints run without a range moves the cursor (a past-range run must not make the
      // next one skip prints).
      const done = {
        lastRunAt: startedAt,
        pending,
        ...(type === "prints" && !ranged && { cursor: oldestLeft ?? startedAt }),
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
    return { ...(saved as SyncRun), updated, pending };
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

  /**
   * The vendor's prints in the range, or since the last run (minus an overlap) without one.
   * A print already imported only gets a plate that was never known.
   */
  async function readPrints(
    id: string,
    instance: IntegrationInstance,
    range: Range,
    signal: AbortSignal,
  ): Promise<ExternalPrint[]> {
    if (!instance.printHistory) return [];
    const last = policyOf(db, id, "prints").cursor;
    const since =
      range.from || range.to
        ? range.from
        : last
          ? new Date(Date.parse(last) - OVERLAP_MS).toISOString()
          : undefined;
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
    // ponytail: a write while reading, but idempotent and only ever filling a blank.
    for (const p of out)
      if (p.plate)
        db.update(prints)
          .set({ plate: p.plate })
          .where(
            and(
              eq(prints.integrationId, id),
              eq(prints.externalId, p.externalId),
              isNull(prints.plate),
            ),
          )
          .run();
    return out;
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
          spool.remainingGrams -= u.grams;
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
    includeSystem: boolean,
    instance?: IntegrationInstance,
    range: Range = {},
    signal = AbortSignal.timeout(TIMEOUT_MS),
  ): Promise<Stored> {
    const from = { kind: "integration" as const, integrationId: row.id };
    if (type === "spools") {
      const rows = spoolRows(db, instance ? await readSpools(row, instance) : []);
      return { entity: type, ignoredHeaders: [], from, rows };
    }
    if (type === "prints") {
      const items = instance ? await readPrints(row.id, instance, range, signal) : [];
      const rows = printRows(db, row.id, items);
      const kept = range.from || range.to ? { from: range.from, to: range.to } : undefined;
      return { entity: type, ignoredHeaders: [], from, rows, range: kept };
    }
    const { lib, dir } = libraryOf(db, adapters, row.id, type);
    const rows = await libraryRows(db, lib, dir, type, { includeSystem, dataDir });
    return { entity: type, ignoredHeaders: [], from, dir, rows };
  }

  /** For the review: a vendor failure comes back as a 502 with its code. */
  async function offer(
    id: string,
    type: ReviewedType,
    includeSystem: boolean,
    range: Range = {},
  ): Promise<Stored> {
    const { row } = capableRow(db, adapters, id, type);
    try {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const instance =
        type === "spools" || type === "prints" ? instanceFor(row, signal) : undefined;
      return await offered(row, type, includeSystem, instance, range, signal);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, codeOf(e), "Couldn't read the source");
    }
  }

  return { run, runAll, test, offer, running, adapters };
}

export type Syncer = ReturnType<typeof createSyncer>;
