import {
  defaultPolicy,
  type IntegrationAdapter,
  IntegrationError,
  type PrinterSnapshot,
  type PrinterStatus,
  type PushUsage,
  pushKey,
  pushTargets,
  type SpoolUsageTarget,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { capableRows } from "./capabilities.ts";
import type { Syncer } from "./sync.ts";

// Spoolman two-way (ADR-0015): what each print took goes back to the spool library its spool came
// from, exactly once. Nothing is sent when a print is recorded; a run works out what each library
// spool should hold per print slot (core's `pushTargets`) and sends only the difference to what it
// last confirmed (`spool_usage_pushes`). So a retry, a restart, an edit or a delete of a print
// all come down to the same thing, and the adapter makes each write idempotent itself.
// The app's own spools are charged as always (`syncUsages`); this only reads what they took.

const {
  filamentBrands,
  filamentMaterials,
  printFilamentUsages,
  prints,
  spools,
  spoolUsageLinks,
  spoolUsagePushes,
  syncPolicies,
} = schema;
type Row = typeof schema.integrations.$inferSelect;

const TIMEOUT_MS = 5 * 60 * 1000;
/** A burst of changes (a bulk edit, a sync) is one run. */
const KICK_MS = 1000;
/**
 * A printer's host reports to the library while it prints and once more as the print ends
 * (Moonraker's `sync_rate` is 5 s): a spool it reports to waits this long after.
 */
export const HOST_GRACE_MS = 60_000;
const BUSY = new Set<PrinterSnapshot["state"]>(["preparing", "printing", "paused"]);
/** In `inUse`: a host reports to a spool it doesn't name (several tools); every spool waits. */
const ANY = "*";

const codeOf = (e: unknown) => (e instanceof IntegrationError ? e.code : "unknown");

export function createSpoolPush(
  db: Db,
  syncer: Pick<Syncer, "usageTarget">,
  adapters: IntegrationAdapter[],
  log: FastifyBaseLogger,
  /** Runs on its own after `kick`; off in tests, which call `run`. */
  auto = false,
) {
  let running: Promise<void> | undefined;
  let again = false;
  let timer: NodeJS.Timeout | undefined;
  /** Integrations whose last run failed: logged once per outage. */
  const failing = new Set<string>();
  /**
   * Library spools (`<adapter>:<id>`) a printer's host reports to right now, and when each one
   * stopped. A write is a read, then a write: one of the host's reports in between would be lost,
   * so such a spool is never written while its host may report to it.
   */
  const inUse = new Set<string>();
  const freedAt = new Map<string, number>();
  const busy = (key: string) => {
    const now = Date.now();
    const recently = (k: string) =>
      now - (freedAt.get(k) ?? Number.NEGATIVE_INFINITY) < HOST_GRACE_MS;
    return inUse.has(key) || inUse.has(ANY) || recently(key) || recently(ANY);
  };

  /** The app spools linked to this library's spools now: app spool id -> library spool id. */
  function links(prefix: string) {
    const rows = db
      .select({ id: spools.id, source: spools.sourceSpool, at: spools.sourceLinkedAt })
      .from(spools)
      .where(isNotNull(spools.sourceSpool))
      .all()
      .filter((s) => s.source?.startsWith(prefix));
    return {
      linked: new Map(rows.map((s) => [s.id, (s.source ?? "").slice(prefix.length)])),
      /** When each was linked; null = before links had a time (all its prints are history). */
      since: new Map(rows.map((s) => [s.id, s.at])),
    };
  }

  /** Spools' charged slots the library doesn't hold already; `before`: of prints made before it. */
  function usagesOf(appSpoolIds: string[], before?: string | null) {
    if (!appSpoolIds.length) return [];
    return db
      .select({
        printId: printFilamentUsages.printId,
        slot: printFilamentUsages.slot,
        appSpoolId: printFilamentUsages.spoolId,
        grams: printFilamentUsages.grams,
      })
      .from(printFilamentUsages)
      .innerJoin(prints, eq(prints.id, printFilamentUsages.printId))
      .where(
        and(
          inArray(printFilamentUsages.spoolId, appSpoolIds),
          eq(printFilamentUsages.chargedAtSource, false),
          before ? lt(prints.createdAt, before) : undefined,
        ),
      )
      .all() as Omit<PushUsage, "vendorSpoolId">[];
  }

  /**
   * A link seen for the first time (an import, a spool made there, one linked again) starts from
   * what the prints made before it took: that is the library's history, not usage to write. One
   * that went away is forgotten; what was sent stays there.
   */
  function settleLinks(
    integrationId: string,
    now: Map<string, string>,
    since: Map<string, string | null>,
  ) {
    const seen = new Map(
      db
        .select()
        .from(spoolUsageLinks)
        .where(eq(spoolUsageLinks.integrationId, integrationId))
        .all()
        .map((l) => [l.appSpoolId, l.vendorSpoolId]),
    );
    const fresh = [...now].filter(([app, vendor]) => seen.get(app) !== vendor);
    const gone = [...seen.keys()].filter((app) => !now.has(app));
    if (!fresh.length && !gone.length) return;
    db.transaction((tx) => {
      for (const [appSpoolId, vendorSpoolId] of fresh) {
        const mine = and(
          eq(spoolUsagePushes.integrationId, integrationId),
          eq(spoolUsagePushes.appSpoolId, appSpoolId),
        );
        tx.delete(spoolUsagePushes).where(mine).run();
        const held = new Map<string, number>();
        // A link without a time is older than this feature: everything before now.
        for (const u of usagesOf([appSpoolId], since.get(appSpoolId) ?? new Date().toISOString())) {
          const key = pushKey(u.printId, u.slot);
          held.set(key, (held.get(key) ?? 0) + u.grams);
        }
        for (const [key, sentGrams] of held)
          tx.insert(spoolUsagePushes)
            .values({ integrationId, key, vendorSpoolId, appSpoolId, sentGrams })
            .onConflictDoUpdate({
              target: [
                spoolUsagePushes.integrationId,
                spoolUsagePushes.key,
                spoolUsagePushes.vendorSpoolId,
              ],
              set: { appSpoolId, sentGrams },
            })
            .run();
        tx.insert(spoolUsageLinks)
          .values({ integrationId, appSpoolId, vendorSpoolId })
          .onConflictDoUpdate({
            target: [spoolUsageLinks.integrationId, spoolUsageLinks.appSpoolId],
            set: { vendorSpoolId },
          })
          .run();
      }
      for (const appSpoolId of gone)
        tx.delete(spoolUsageLinks)
          .where(
            and(
              eq(spoolUsageLinks.integrationId, integrationId),
              eq(spoolUsageLinks.appSpoolId, appSpoolId),
            ),
          )
          .run();
    });
  }

  /**
   * App spools in no library that a print charged since the integration was added: made there, as
   * they are now (so nothing of theirs is written after). Older prints are no reason to add one.
   */
  function toCreate(row: Row) {
    return db
      .selectDistinct({
        id: spools.id,
        brand: filamentBrands.name,
        material: filamentMaterials.name,
        densityGcm3: filamentMaterials.densityGcm3,
        name: spools.name,
        colorHex: spools.colorHex,
        colorName: spools.colorName,
        initialGrams: spools.initialGrams,
        remainingGrams: spools.remainingGrams,
        emptyWeightGrams: spools.emptyWeightGrams,
      })
      .from(printFilamentUsages)
      .innerJoin(prints, eq(prints.id, printFilamentUsages.printId))
      .innerJoin(spools, eq(spools.id, printFilamentUsages.spoolId))
      .innerJoin(filamentMaterials, eq(filamentMaterials.id, spools.materialId))
      .leftJoin(filamentBrands, eq(filamentBrands.id, spools.brandId))
      .where(
        and(
          isNull(spools.sourceSpool),
          isNull(spools.archivedAt),
          eq(printFilamentUsages.chargedAtSource, false),
          gte(prints.createdAt, row.createdAt),
        ),
      )
      .all();
  }

  async function createMissing(row: Row, prefix: string, target: SpoolUsageTarget) {
    // Made as the spool was when read: every print before this is in it.
    const readAt = new Date().toISOString();
    for (const s of toCreate(row)) {
      const { spoolId } = await target.createSpool({
        appSpoolId: s.id,
        brand: s.brand,
        material: s.material,
        name: s.name,
        colorHex: s.colorHex,
        colorName: s.colorName,
        densityGcm3: s.densityGcm3,
        initialGrams: s.initialGrams,
        remainingGrams: s.remainingGrams,
        emptyWeightGrams: s.emptyWeightGrams,
      });
      db.update(spools)
        .set({ sourceSpool: `${prefix}${spoolId}`, sourceLinkedAt: readAt })
        .where(and(eq(spools.id, s.id), isNull(spools.sourceSpool)))
        .run();
    }
  }

  function save(integrationId: string, t: ReturnType<typeof pushTargets>["targets"][number]) {
    const at = and(
      eq(spoolUsagePushes.integrationId, integrationId),
      eq(spoolUsagePushes.key, t.key),
      eq(spoolUsagePushes.vendorSpoolId, t.vendorSpoolId),
    );
    if (t.grams === 0) {
      db.delete(spoolUsagePushes).where(at).run();
      return;
    }
    db.insert(spoolUsagePushes)
      .values({ integrationId, ...t, sentGrams: t.grams })
      .onConflictDoUpdate({
        target: [
          spoolUsagePushes.integrationId,
          spoolUsagePushes.key,
          spoolUsagePushes.vendorSpoolId,
        ],
        set: { appSpoolId: t.appSpoolId, sentGrams: t.grams },
      })
      .run();
  }

  /** What still waits, on the integration's `spoolUsage` line; `lastRunAt` once all went. */
  function setPending(integrationId: string, pending: number) {
    const set = { pending, ...(!pending && { lastRunAt: new Date().toISOString() }) };
    db.insert(syncPolicies)
      .values({ integrationId, type: "spoolUsage", ...defaultPolicy("spoolUsage"), ...set })
      .onConflictDoUpdate({ target: [syncPolicies.integrationId, syncPolicies.type], set })
      .run();
  }

  async function pushOne(row: Row, adapter: IntegrationAdapter) {
    const prefix = `${adapter.id}:`;
    let error: unknown;
    let target: SpoolUsageTarget | undefined;
    try {
      target = syncer.usageTarget(row.id, AbortSignal.timeout(TIMEOUT_MS));
      if (target) await createMissing(row, prefix, target);
    } catch (e) {
      error = e;
    }
    const { linked, since } = links(prefix);
    settleLinks(row.id, linked, since);
    const usages = usagesOf([...linked.keys()]).map((u) => ({
      ...u,
      vendorSpoolId: linked.get(u.appSpoolId) ?? "",
    }));
    const sent = db
      .select()
      .from(spoolUsagePushes)
      .where(eq(spoolUsagePushes.integrationId, row.id))
      .all();
    const { targets, drop } = pushTargets(usages, sent, (id) => linked.get(id));
    for (const d of drop) save(row.id, { ...d, grams: 0, sent: d.sentGrams });
    let done = 0;
    let waiting = 0;
    if (target && !error)
      for (const t of targets) {
        // Its host may be reporting to it: a later run writes it (the sync tick, every minute).
        if (busy(`${prefix}${t.vendorSpoolId}`)) {
          waiting++;
          continue;
        }
        try {
          const { gone } = await target.writeUsage({
            spoolId: t.vendorSpoolId,
            key: t.key,
            grams: t.grams,
            sent: t.sent,
          });
          // Nothing to charge there any more: settled, so it isn't asked again every run.
          if (gone)
            log.warn(
              { integrationId: row.id, vendorSpoolId: t.vendorSpoolId },
              "spool usage not written: the spool is gone from the library",
            );
          save(row.id, t);
          done++;
        } catch (e) {
          // The library is failing: the rest waits for the next run.
          error = e;
          break;
        }
      }
    const left = targets.length - done + (error ? toCreate(row).length : 0);
    setPending(row.id, left);
    if (error) {
      if (!failing.has(row.id))
        log.warn({ integrationId: row.id, code: codeOf(error), left }, "spool usage not written");
      failing.add(row.id);
    } else {
      if (failing.delete(row.id)) log.info({ integrationId: row.id }, "spool usage written again");
      if (done) log.info({ integrationId: row.id, written: done }, "spool usage written");
      if (waiting)
        log.debug({ integrationId: row.id, waiting }, "spool usage waits: its printer reports it");
    }
  }

  /** What the printers do now (`PrinterStatusRunner.subscribe`): which spools their hosts report. */
  function watch(all: PrinterStatus[]) {
    const now = Date.now();
    const cur = new Set(
      all.flatMap(({ snapshot: s }) =>
        BUSY.has(s.state)
          ? s.slots.flatMap((slot) => (slot.chargedAtSource ? [slot.spoolId ?? ANY] : []))
          : [],
      ),
    );
    for (const k of inUse) if (!cur.has(k)) freedAt.set(k, now);
    inUse.clear();
    for (const k of cur) {
      inUse.add(k);
      freedAt.delete(k);
    }
    for (const [k, at] of freedAt) if (now - at >= HOST_GRACE_MS) freedAt.delete(k);
  }

  /** Every working source that takes usage back, one after another; one run at a time. */
  function run(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        for (const { row, adapter } of capableRows(db, adapters, "spoolUsage"))
          await pushOne(row, adapter).catch((err) =>
            log.error({ err, integrationId: row.id }, "spool usage run failed"),
          );
      } while (again);
    })().finally(() => {
      running = undefined;
    });
    return running;
  }

  return {
    run,
    watch,
    /** Something charged or gave back filament: a run soon. */
    kick() {
      if (!auto) return;
      timer ??= setTimeout(() => {
        timer = undefined;
        void run();
      }, KICK_MS).unref();
    },
    close: () => clearTimeout(timer),
  };
}

export type SpoolPush = ReturnType<typeof createSpoolPush>;
