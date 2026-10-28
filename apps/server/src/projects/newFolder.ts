import { rmdir } from "node:fs/promises";
import type { Db } from "@3d-maker-suite/db";
import { HttpError } from "../errors.ts";
import { PAD, padded } from "../lib/numbers.ts";
import { safeName, validName } from "./paths.ts";
import { listRoots, type Place, type Root, rootFs } from "./rootFs.ts";

/** The folder name the app gives a project: `<001>_<name>`. The scan reads the same name back. */
export const folderName = (number: number, name: string) =>
  `${padded(number, PAD.project)}_${safeName(name)}`;

/**
 * Makes `<root>/<base>` for a new project. `rootId` must be a configured root; it may be left out
 * when there is only one. `check` runs on the root before anything is made (it throws to refuse).
 */
export async function newProjectFolder(
  db: Db,
  rootId: string | undefined,
  base: string,
  check?: (root: Root) => void,
): Promise<Place> {
  const roots = listRoots(db);
  if (!roots.length) throw new HttpError(409, "no_project_root", "No project folder is set up");
  if (!rootId && roots.length > 1)
    throw new HttpError(400, "root_required", "Choose the project folder to create it in");
  const root = rootId ? roots.find((r) => r.id === rootId) : roots[0];
  if (!root) throw new HttpError(400, "invalid_root", "Not a configured project folder");
  if (!validName(base)) throw new HttpError(400, "invalid_name", "Name can't be a folder name");
  check?.(root);
  await rootFs(db, root).mkdir(base);
  return { root, rel: base };
}

/**
 * Undoes `newProjectFolder` when what came after failed (only while it's still empty).
 * ponytail: a folder on a device stays (the connector has no remove); it is an empty folder.
 */
export async function dropNewFolder(db: Db, { root, rel }: Place) {
  const dir = await rootFs(db, root).local(rel);
  if (dir) await rmdir(dir).catch(() => {});
}
