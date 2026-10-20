import { z } from "zod";
import { isoDate } from "./entities.ts";

/** Relative to the project folder, with `/` separators. The server rejects anything that leaves it. */
const relPath = z.string().min(1).max(1000);

/** No `path` (or "") lists the project folder itself. */
export const projectFilesQuery = z.object({ path: z.string().max(1000).default("") });
export const projectFilePathQuery = z.object({ path: relPath });

export const projectFileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["dir", "file"]),
  /** Bytes; 0 for folders. */
  size: z.number().int().nonnegative(),
  modifiedAt: isoDate,
});

export const projectFilesListSchema = z.object({
  path: z.string(),
  entries: z.array(projectFileEntrySchema),
});

/** `PUT /:id/files/content`: the raw file is the body (`application/octet-stream`). */
export const projectUploadQuery = z.object({
  path: relPath,
  /** Explicit, so an upload never silently overwrites. */
  replace: z.enum(["true", "false"]).default("false"),
});

export const projectFolderCreateSchema = z.object({ path: relPath });
/** Rename = move within the same folder. `to` must not exist. */
export const projectFileMoveSchema = z.object({ from: relPath, to: relPath });
export const projectFilePathSchema = z.object({ path: z.string() });

/** Deleted project files, summed over every project root. */
export const projectTrashSchema = z.object({
  items: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});

export type ProjectFileEntry = z.infer<typeof projectFileEntrySchema>;
export type ProjectFilesList = z.infer<typeof projectFilesListSchema>;
export type ProjectFileMove = z.infer<typeof projectFileMoveSchema>;
export type ProjectTrash = z.infer<typeof projectTrashSchema>;
