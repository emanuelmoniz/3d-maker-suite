import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  type ImportCell,
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  matchNumberedRows,
  PROJECT_EDITABLE_FIELDS,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { projectLabel } from "../lib/catalog.ts";
import { assertNumberFree, freeNumber, nextNumber, numberCell } from "../lib/numbers.ts";
import { rootPaths } from "../lib/preferences.ts";
import { parseFolderName } from "../projects/folderName.ts";
import type { WriteRow } from "./review.ts";

const { orderProjects, prints, projects } = schema;

const str = (c: ImportCell | undefined) => (typeof c === "string" && c.trim() ? c.trim() : null);
/** A folder as the scanner stores it, so a file cell and `folderPath` compare equal. */
const folderOf = (c: ImportCell | undefined) => {
  const s = str(c);
  return s ? resolve(s) : null;
};
/** Paths compare without case on Windows, like the file system does. */
const pathKey = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
/**
 * `folder` is inside a project root (a missing folder by its resolved path). Like `insideRoots`,
 * but sync for the preview; the apply makes or scans only folders that pass it.
 */
const inRoots = (folder: string, roots: string[]) => {
  const f = real(folder);
  return roots.some((r) => {
    const rel = relative(real(r), f);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
};

/** The columns a row gives that the scan would otherwise fill. */
const SCANNED = ["name", "description", "sourceUrl"] as const;

type Look = { owners: Map<string, { id: string; number: number | null }>; roots: string[] };
function build(db: Db): Look {
  return {
    owners: new Map(
      db
        .select({ id: projects.id, number: projects.number, folder: projects.folderPath })
        .from(projects)
        .where(isNotNull(projects.folderPath))
        .all()
        .map((p) => [pathKey(p.folder ?? ""), p]),
    ),
    roots: rootPaths(db),
  };
}
// A preview or an apply runs in one synchronous stretch (see `lookups` in prints.ts).
let cached: { db: Db; look: Look } | null = null;
function lookups(db: Db): Look {
  if (cached?.db !== db) {
    cached = { db, look: build(db) };
    queueMicrotask(() => {
      cached = null;
    });
  }
  return cached.look;
}

/**
 * Exactly `ids` become the project's prints. A print of an order keeps its project (an order's
 * print needs one); one moved here joins its order to this project, as the prints API does.
 */
function setPrints(db: Db, projectId: string, ids: string[] | undefined) {
  if (!ids) return;
  db.update(prints)
    .set({ projectId: null })
    .where(and(eq(prints.projectId, projectId), isNull(prints.orderId), notInArray(prints.id, ids)))
    .run();
  if (!ids.length) return;
  db.update(prints).set({ projectId }).where(inArray(prints.id, ids)).run();
  for (const p of db
    .select({ orderId: prints.orderId })
    .from(prints)
    .where(and(inArray(prints.id, ids), isNotNull(prints.orderId)))
    .all())
    if (p.orderId)
      db.insert(orderProjects)
        .values({ orderId: p.orderId, projectId })
        .onConflictDoNothing()
        .run();
}

/**
 * Projects from a file. The number is the identity; a folder must be inside a project root and
 * belong to no other project. The scan of the folder and the print links follow the apply (see the
 * import route), since both read the disk.
 */
export const projectImport = {
  /** Active projects, in the shape of the import columns. */
  targets: (db: Db): ImportTarget[] =>
    db
      .select({ project: projects, label: projectLabel })
      .from(projects)
      .where(isNull(projects.archivedAt))
      .orderBy(projects.number)
      .all()
      .map(({ project: p, label }) => ({
        id: p.id,
        label,
        values: {
          number: p.number,
          name: p.name,
          description: p.description,
          sourceUrl: p.sourceUrl,
          folder: p.folderPath,
        },
      })),

  match: matchNumberedRows(),

  canon: (_db: Db, v: ImportValues): ImportValues => ({ ...v, folder: folderOf(v.folder) }),

  missing: () => ({}),

  check(db: Db, v: ImportValues) {
    const folder = folderOf(v.folder);
    if (!folder) return [];
    const look = lookups(db);
    const errors: { column: string; code: ImportErrorCode }[] = [];
    if (!inRoots(folder, look.roots)) errors.push({ column: "folder", code: "outside_roots" });
    const owner = look.owners.get(pathKey(folder));
    if (owner && owner.number !== numberCell(v.number))
      errors.push({ column: "folder", code: "folder_in_use" });
    return errors;
  },

  /** A folder named by an earlier row of the file is in use. */
  checkFile(_db: Db, rows: ImportValues[]) {
    const seen = new Set<string>();
    return rows.map((v) => {
      const folder = folderOf(v.folder);
      if (!folder) return [];
      const key = pathKey(folder);
      if (seen.has(key)) return [{ column: "folder", code: "folder_in_use" as const }];
      seen.add(key);
      return [];
    });
  },

  /** A folder that isn't there (yet) is offered to pick or create in the review. */
  flags: (_db: Db, v: ImportValues) => {
    const folder = folderOf(v.folder);
    return folder && !existsSync(folder) ? { folderMissing: true } : {};
  },

  /** Returns the new project's id. A free number in the folder's prefix is its number. */
  create(db: Db, v: ImportValues, row: WriteRow) {
    const folder = folderOf(v.folder);
    const prefix = folder ? parseFolderName(basename(folder)).number : null;
    const given = Object.fromEntries(SCANNED.flatMap((k) => (str(v[k]) ? [[k, str(v[k])]] : [])));
    const { id } = db
      .insert(projects)
      .values({
        number:
          freeNumber(db, projects, numberCell(v.number)) ??
          freeNumber(db, projects, prefix || null) ??
          nextNumber(projects),
        name: str(v.name) ?? "",
        description: str(v.description),
        sourceUrl: str(v.sourceUrl),
        folderPath: folder,
        editedFields: row.fromFolder ? [] : PROJECT_EDITABLE_FIELDS.filter((f) => f in given),
      })
      .returning({ id: projects.id })
      .get();
    setPrints(db, id, row.prints);
    return id;
  },

  /** Writes `patch` (only the values that change). From the folder: the scan sets the names. */
  update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
    const cur = db.select().from(projects).where(eq(projects.id, target.id)).get();
    if (!cur) return;
    const set: Partial<typeof projects.$inferInsert> = {};
    const number = numberCell(patch.number);
    if (number) {
      assertNumberFree(db, projects, "project", number, cur.id);
      set.number = number;
    }
    const edited = new Set(cur.editedFields);
    for (const k of SCANNED)
      if (row.fromFolder) edited.delete(k);
      else if (k in patch) {
        if (k === "name") set.name = str(patch.name) ?? cur.name;
        else set[k] = str(patch[k]);
        edited.add(k);
      }
    if ("folder" in patch) set.folderPath = folderOf(patch.folder);
    set.editedFields = [...edited];
    db.update(projects).set(set).where(eq(projects.id, cur.id)).run();
    setPrints(db, cur.id, row.prints);
  },
};
