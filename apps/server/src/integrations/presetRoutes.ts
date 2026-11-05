import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, ne } from "drizzle-orm";
import type { StoredRow } from "../import/review.ts";

const { presetRoutes } = schema;

/**
 * One preset, one route into the catalog (ADR-0019): of `rows`, the ones `integrationId` counts,
 * reviews and alerts for. The first route to see a preset owns it; `take` (an account's cloud)
 * takes the ones it lists from any other route. Renumbered, as the review counts rows from 1.
 */
export function ownRows(
  db: Db,
  integrationId: string,
  entity: string,
  rows: StoredRow[],
  { take = false } = {},
): StoredRow[] {
  const mine = db.transaction((tx) =>
    rows.filter((r) => {
      if (!r.source) return true;
      const route = { entity, source: r.source, integrationId };
      const insert = tx.insert(presetRoutes).values(route);
      (take
        ? insert.onConflictDoUpdate({
            target: [presetRoutes.entity, presetRoutes.source],
            set: { integrationId },
          })
        : insert.onConflictDoNothing()
      ).run();
      return routeOf(tx, entity, r.source) === integrationId;
    }),
  );
  return mine.map((r, i) => ({ ...r, n: i + 1 }));
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const routeOf = (db: Db | Tx, entity: string, source: string) =>
  db
    .select({ id: presetRoutes.integrationId })
    .from(presetRoutes)
    .where(and(eq(presetRoutes.entity, entity), eq(presetRoutes.source, source)))
    .get()?.id;

/** The presets of `entity` another integration than `integrationId` is the route of. */
export const othersRoutes = (db: Db, integrationId: string, entity: string) =>
  new Set(
    db
      .select({ source: presetRoutes.source })
      .from(presetRoutes)
      .where(and(eq(presetRoutes.entity, entity), ne(presetRoutes.integrationId, integrationId)))
      .all()
      .map((r) => r.source),
  );

/** Its row is gone from the catalog: the next route to see the preset owns it. */
export const releaseRoute = (db: Db, entity: string, source: string) =>
  db
    .delete(presetRoutes)
    .where(and(eq(presetRoutes.entity, entity), eq(presetRoutes.source, source)))
    .run();
