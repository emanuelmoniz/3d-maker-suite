import { existsSync } from "node:fs";
import type { IntegrationAdapter } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import type { findSlicers } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";

const { integrations } = schema;
type Row = typeof integrations.$inferSelect;

/** Whether a local slicer's program is there to run: the row's path exists on this computer. */
export const programExists = (row: Pick<Row, "slicerPath">) => {
  const program = row.slicerPath?.trim();
  return !!program && existsSync(program);
};

/**
 * Finds the program of the slicers installed on this server's computer (6.2.0 Step 3g), so
 * **Slicer program** needs no typing: a slicer is looked up when it is added and at each start when
 * its path is empty or gone (an update moved it). A path that exists, typed or found, is kept.
 * Without `find` (tests) nothing is looked up.
 */
export function createSlicerProgram(
  db: Db,
  adapters: IntegrationAdapter[],
  find?: typeof findSlicers,
) {
  /** Sets `row`'s program when it has none that exists; false = none found. */
  async function fill(row: Row) {
    const adapter = adapters.find((a) => a.id === row.adapterId);
    const lib = adapter?.library?.id;
    if (!find || adapter?.kind !== "local" || !adapter.desktop || !lib) return false;
    if (programExists(row)) return true;
    const [found] = await find([{ ...adapter.desktop, id: adapter.id, library: lib }]).catch(
      () => [],
    );
    // A Flatpak runs through `flatpak run`: no program path to store.
    if (!found || found.cli.args.length > 0 || !existsSync(found.cli.cmd)) return false;
    db.update(integrations)
      .set({ slicerPath: found.cli.cmd, updatedAt: new Date().toISOString() })
      .where(eq(integrations.id, row.id))
      .run();
    return true;
  }

  return {
    fill,
    /** Every local slicer, at start. */
    async all() {
      for (const row of db.select().from(integrations).all()) await fill(row);
    },
  };
}

export type SlicerProgram = ReturnType<typeof createSlicerProgram>;
