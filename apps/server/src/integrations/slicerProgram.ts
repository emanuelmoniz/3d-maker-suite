import { existsSync } from "node:fs";
import type { IntegrationAdapter } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import type { findSlicers } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";

const { integrations } = schema;
type Row = typeof integrations.$inferSelect;

/**
 * Whether a local slicer's program is there to run: the row's path exists on this computer. A
 * command with arguments (`flatpak run <id>`) was found by the finder, which looks again at each
 * start (`createSlicerProgram`).
 */
export const programExists = (row: Pick<Row, "slicerPath" | "slicerArgs">) => {
  const program = row.slicerPath?.trim();
  return !!program && (!!row.slicerArgs?.length || existsSync(program));
};

/**
 * Finds the program of the slicers installed on this server's computer (6.2.0 Step 3g), so
 * **Slicer program** needs no typing: a slicer is looked up when it is added and at each start when
 * its path is empty or gone (an update moved it). A path that exists, typed or found, is kept. A
 * Flatpak install is found as a command (`flatpak run <id>`, Step 3h).
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
    // A path that exists stays; a found command (Flatpak) is looked up again, as it may be gone.
    if (programExists(row) && !row.slicerArgs?.length) return true;
    const [found] = await find([{ ...adapter.desktop, id: adapter.id, library: lib }]).catch(
      () => [],
    );
    // A Flatpak runs as `flatpak run <id>`: `slicerPath` is `flatpak`, the rest its arguments.
    const args = found?.cli.args ?? [];
    if (!found || (!args.length && !existsSync(found.cli.cmd))) {
      if (row.slicerArgs?.length)
        db.update(integrations)
          .set({ slicerPath: null, slicerArgs: null, updatedAt: new Date().toISOString() })
          .where(eq(integrations.id, row.id))
          .run();
      return false;
    }
    db.update(integrations)
      .set({
        slicerPath: found.cli.cmd,
        slicerArgs: args.length ? args : null,
        updatedAt: new Date().toISOString(),
      })
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
