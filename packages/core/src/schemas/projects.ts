import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { ORIGINS, PROJECT_EDITABLE_FIELDS, PROJECT_FILE_KINDS } from "./enums.ts";
import { listQuery } from "./list.ts";

const nullableText = z.string().nullable();

export const projectFileSchema = z.object({
  /** Relative to the project folder, with `/` separators. */
  path: z.string(),
  kind: z.enum(PROJECT_FILE_KINDS),
  size: z.number().int().nonnegative(),
});

// Same shape as `ThreeMfInfo` from @3d-maker-suite/3mf; core does not depend on that package.
const threeMfFilamentSchema = z.object({
  slot: z.number().int(),
  type: nullableText,
  color: nullableText,
  profile: nullableText,
  grams: z.number().nullable(),
  meters: z.number().nullable(),
});
export const projectPlateSchema = z.object({
  index: z.number().int(),
  name: nullableText,
  sliced: z.boolean(),
  printTimeSeconds: z.number().nullable(),
  weightGrams: z.number().nullable(),
  filaments: z.array(threeMfFilamentSchema),
  multicolor: z.boolean(),
  objects: z.array(z.string()),
  thumbnail: nullableText,
});
export const projectModelSchema = z.object({
  /** The 3MF file, relative to the project folder. */
  file: z.string(),
  slicer: z.object({ name: z.string(), version: nullableText }).nullable(),
  printerModel: nullableText,
  nozzleDiameter: z.number().nullable(),
  sliced: z.boolean(),
  multicolor: z.boolean(),
  plates: z.array(projectPlateSchema),
});

/** What the scanner found. Always rewritten by a re-scan; never user-edited. */
export const projectMetaSchema = z.object({
  files: z.array(projectFileSchema).default([]),
  models: z.array(projectModelSchema).default([]),
  /** Distinct filament types over all parsed 3MFs (for filters). */
  materials: z.array(z.string()).default([]),
  multicolor: z.boolean().default(false),
});

export const projectSchema = z.object({
  id,
  name: z.string().min(1),
  description: nullableText,
  /** Absolute. Null for a project that has no folder. */
  folderPath: nullableText,
  /** The main model file (absolute), picked by the scanner. */
  filePath: nullableText,
  sourceUrl: z.httpUrl().nullable(),
  /** Relative to the data directory; serve it with `GET /api/projects/:id/thumbnail`. */
  thumbnailPath: nullableText,
  meta: projectMetaSchema,
  /** Fields the user changed; a re-scan leaves them alone. */
  editedFields: z.array(z.enum(PROJECT_EDITABLE_FIELDS)),
  archivedAt: isoDate.nullable(),
  origin: z.enum(ORIGINS),
  integrationId: id.nullable(),
  externalId: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const editable = {
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  sourceUrl: z.httpUrl().nullable(),
};

/** Fields given here count as user-edited. `folderPath` must be an existing directory. */
export const projectInputSchema = z.object({
  name: editable.name,
  description: editable.description.optional(),
  sourceUrl: editable.sourceUrl.optional(),
  folderPath: z.string().min(1).optional(),
});

/** Any subset. Every field sent becomes user-edited. */
export const projectPatchSchema = z.object(editable).partial().strict();

export const projectSortFields = ["name", "createdAt"] as const;
export const projectListQuery = listQuery(projectSortFields);

export const projectScanStatusSchema = z.object({
  state: z.enum(["idle", "running"]),
  /** "discovering" has no known total yet. */
  phase: z.enum(["discovering", "scanning"]).nullable(),
  total: z.number().int(),
  done: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  failed: z.number().int(),
  /** Configured roots that don't exist or aren't folders. */
  missingRoots: z.array(z.string()),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectMeta = z.infer<typeof projectMetaSchema>;
export type ProjectFile = z.infer<typeof projectFileSchema>;
export type ProjectModel = z.infer<typeof projectModelSchema>;
export type ProjectInput = z.input<typeof projectInputSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
export type ProjectScanStatus = z.infer<typeof projectScanStatusSchema>;
