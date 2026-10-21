import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Db } from "@3d-maker-suite/db";
import { HttpError } from "../errors.ts";
import { insideRoots } from "../lib/launcher.ts";
import { PAD, padded } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import { fsError } from "../routes/fs.ts";
import { safeName, validName } from "./paths.ts";

/** The folder name the app gives a project: `<001>_<name>`. The scan reads the same name back. */
export const folderName = (number: number, name: string) =>
  `${padded(number, PAD.project)}_${safeName(name)}`;

/**
 * Makes `<root>/<base>` for a new project. `root` must be a configured root; it may be left out
 * when there is only one.
 */
export async function newProjectFolder(db: Db, root: string | undefined, base: string) {
  const roots = readPreferences(db).projectRoots;
  if (!roots.length) throw new HttpError(409, "no_project_root", "No project folder is set up");
  if (!root && roots.length > 1)
    throw new HttpError(400, "root_required", "Choose the project folder to create it in");
  const chosen = root ? roots.find((r) => resolve(r) === resolve(root)) : roots[0];
  const real = chosen && (await insideRoots(chosen, [chosen]));
  if (!real) throw new HttpError(400, "invalid_root", "Not a configured project folder");
  if (!validName(base)) throw new HttpError(400, "invalid_name", "Name can't be a folder name");
  const folder = join(real, base);
  await mkdir(folder).catch((e) =>
    Promise.reject(
      e.code === "EEXIST" ? new HttpError(409, "folder_exists", "The folder exists") : fsError(e),
    ),
  );
  return folder;
}
