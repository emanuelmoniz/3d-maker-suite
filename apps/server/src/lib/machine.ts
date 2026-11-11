import { type DevicePresetLibrary, emptyPresetLibrary, presetSwitches } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "./hubChannel.ts";

const { devices } = schema;
type Device = typeof devices.$inferSelect;

/** A live request's failure: ENOTSUP is a connector older than the request (it updates itself). */
export const deviceError = (err: NodeJS.ErrnoException) =>
  err.code === "ENOTSUP"
    ? new HttpError(409, "device_outdated", "The connector is too old for this")
    : new HttpError(502, "device_failed", "The connector couldn't do that");

/**
 * Saves one library's switches on a machine (ADR-0021). A change to its preset switches goes to
 * the connector first while it's online (`presets.set`; a connector before 5.4.0 Step 21's answers
 * ENOTSUP and nothing is saved); offline, it reads them when it connects.
 */
export async function setPresetLibrary(
  db: Db,
  channel: HubChannel,
  row: Device,
  library: string,
  now: DevicePresetLibrary,
) {
  // No entry yet reads as every switch off: a first Catalog switch asks the connector nothing.
  const old = row.presetLibraries[library] ?? emptyPresetLibrary();
  const libraries = { ...row.presetLibraries, [library]: now };
  const presetsChanged =
    old.presets.share !== now.presets.share || old.presets.receive !== now.presets.receive;
  if (presetsChanged && channel.online(row.id))
    await channel.ask(
      row.id,
      (requestId) => ({ type: "presets.set", requestId, libraries: presetSwitches(libraries) }),
      z.null(),
      { error: deviceError },
    );
  db.update(devices)
    .set({
      presetLibraries: libraries,
      // Receive off: what it last said of that slicer no longer holds.
      ...(!now.presets.receive && {
        presetInstall: row.presetInstall?.filter((p) => p.library !== library) ?? null,
      }),
      ...(!now.catalog.receive && {
        catalogInstall: row.catalogInstall?.filter((p) => p.library !== library) ?? null,
      }),
    })
    .where(eq(devices.id, row.id))
    .run();
}
