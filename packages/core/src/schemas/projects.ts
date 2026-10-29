import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { ORIGINS, PROJECT_EDITABLE_FIELDS, PROJECT_FILE_KINDS } from "./enums.ts";
import { type ColumnFilter, listQuery } from "./list.ts";
import { PROJECT_SLICING } from "./projectSlicing.ts";

const nullableText = z.string().nullable();

export const projectFileSchema = z.object({
  /** Relative to the project folder, with `/` separators. */
  path: z.string(),
  kind: z.enum(PROJECT_FILE_KINDS),
  size: z.number().int().nonnegative(),
  /** Last change (ms since epoch). Older scans lack it. */
  mtime: z.number().optional(),
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
  /** Sliced when saved, even if the slicer kept no results (`sliced` false). Older scans lack it. */
  slicedOnSave: z.boolean().default(false),
  printTimeSeconds: z.number().nullable(),
  weightGrams: z.number().nullable(),
  filaments: z.array(threeMfFilamentSchema),
  multicolor: z.boolean(),
  objects: z.array(z.string()),
  /** Build item indexes of the plate, for the 3D viewer. Older scans lack it. */
  items: z.array(z.number().int()).default([]),
  thumbnail: nullableText,
});
export const projectModelSchema = z.object({
  /** The 3MF file, relative to the project folder. */
  file: z.string(),
  slicer: z.object({ name: z.string(), version: nullableText }).nullable(),
  printerModel: nullableText,
  /** The print preset the file was saved with. Older scans lack it. */
  printProfile: nullableText.default(null),
  nozzleDiameter: z.number().nullable(),
  sliced: z.boolean(),
  multicolor: z.boolean(),
  plates: z.array(projectPlateSchema),
  /** Per build item, per component: part color for the 3D viewer. Older scans lack it. */
  partColors: z.array(z.array(nullableText)).default([]),
  /** The MakerWorld model the file came from; links prints of it. Older scans lack it. */
  designTitle: nullableText.default(null),
});

/** Painted triangles of one 3MF for the 3D viewer; same shape as `ThreeMfPaint`. */
export const projectPaintSchema = z.object({
  palette: z.array(z.string()),
  /** Per build item, per component: run-length `[state, count, ...]` over triangles, or null. */
  parts: z.array(z.array(z.array(z.number().int()).nullable())),
});
export type ProjectPaint = z.infer<typeof projectPaintSchema>;

/** What the scanner found. Always rewritten by a re-scan; never user-edited. */
export const projectMetaSchema = z.object({
  files: z.array(projectFileSchema).default([]),
  models: z.array(projectModelSchema).default([]),
  /** Distinct filament types over all parsed 3MFs (for filters). */
  materials: z.array(z.string()).default([]),
  multicolor: z.boolean().default(false),
});

/** Gallery picks, relative to the project folder (`/`); `""` in `folders` is the folder itself. */
export const projectGallerySchema = z.object({
  folders: z.array(z.string()),
  images: z.array(z.string()),
});

export const projectSchema = z.object({
  id,
  /** Short unique number the project goes by ("001-aquaterrario"); from the folder prefix if any. */
  number: z.number().int().positive(),
  name: z.string().min(1),
  description: nullableText,
  /** Doc in the project folder (relative, `/`) whose text is the description; re-read on scans. */
  descriptionFile: nullableText,
  /** The root the folder is in. Null for a project that has no folder. */
  rootId: id.nullable(),
  /** The folder, relative to its root (`/`). */
  folder: nullableText,
  /** The folder as an absolute path on its root's location, for showing and picking. */
  folderPath: nullableText,
  /** The folder it was unlinked from and kept (absolute): scans skip it; linking it again keeps everything. */
  unlinkedFolder: nullableText,
  /** The main model file (relative, `/`), picked by the scanner. */
  filePath: nullableText,
  sourceUrl: z.httpUrl().nullable(),
  /** Relative to the data directory; serve it with `GET /api/projects/:id/thumbnail`. */
  thumbnailPath: nullableText,
  gallery: projectGallerySchema,
  /** Image (relative, `/`) chosen as the cover; null: the scanner picks. */
  coverFile: nullableText,
  meta: projectMetaSchema,
  /** Fields the user changed; a re-scan leaves them alone. */
  editedFields: z.array(z.enum(PROJECT_EDITABLE_FIELDS)),
  /** Slice again when a sliced file changes; null = as its project root says. */
  autoSlice: z.boolean().nullable(),
  /** Slicer integration for plates without their own; null = the default (see `pickSlicer`). */
  slicerIntegrationId: id.nullable(),
  archivedAt: isoDate.nullable(),
  /** The user it belongs to (ADR-0014); null = nobody's. */
  ownerId: id.nullable(),
  origin: z.enum(ORIGINS),
  integrationId: id.nullable(),
  externalId: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/**
 * The project page's project: plus whether its folder is there. null: no folder; "missing": the
 * folder is gone (deleted or renamed); "offline": it is in a device root whose device isn't
 * connected, so what is shown is the last known data.
 */
export const projectDetailSchema = projectSchema.extend({
  folderState: z.enum(["ok", "missing", "offline"]).nullable(),
  /** Gallery images its device didn't send (over the folder's caps): they don't show offline. */
  galleryLeftOut: z.array(z.string()),
  /** Who it belongs to (ADR-0014); null = nobody's. */
  owner: z.object({ id, displayName: z.string() }).nullable(),
  /** Whether the caller may change it; otherwise it is download-only for them. */
  canEdit: z.boolean(),
});

/** A row of the projects list: the project plus when it was last printed (null: never). */
export const projectListItemSchema = projectSchema.extend({
  lastPrintAt: isoDate.nullable(),
  slicing: z.enum(PROJECT_SLICING),
  /** In a device root whose device isn't connected (ADR-0014). */
  offline: z.boolean(),
});

const editable = {
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  sourceUrl: z.httpUrl().nullable(),
};

/**
 * Fields given here count as user-edited. `folderPath` must be an existing directory;
 * `createFolder` makes `<root>/<number>_<name>` instead (`rootId` may be left out with one root).
 */
export const projectInputSchema = z
  .object({
    /** Defaults to the next free number. Not a scanned field, so a re-scan never touches it. */
    number: projectSchema.shape.number.optional(),
    name: editable.name,
    description: editable.description.optional(),
    sourceUrl: editable.sourceUrl.optional(),
    folderPath: z.string().min(1).optional(),
    createFolder: z.boolean().optional(),
    /** The root `createFolder` makes it in. */
    rootId: id.optional(),
  })
  .refine((p) => !(p.createFolder && p.folderPath), {
    message: "Give folderPath or createFolder, not both",
    path: ["createFolder"],
  });

/** Each project root's trash folder: deleted files and trashed project folders. Scans skip it. */
export const PROJECT_TRASH_DIR = ".3d-maker-suite-trash";

/**
 * What happens to the folder a project leaves: "trash" moves it to its root's trash folder,
 * "keep" leaves it as it is (scans skip it; linking it again later keeps everything).
 */
export const PROJECT_FOLDER_RELEASE = ["trash", "keep"] as const;
/** Switching folders also offers "move": the old folder's content goes along to the new one. */
export const PROJECT_FOLDER_PREVIOUS = [...PROJECT_FOLDER_RELEASE, "move"] as const;
export const projectUnlinkQuery = z.object({ files: z.enum(PROJECT_FOLDER_RELEASE) });

/**
 * Gives a project a folder: `path` links an existing folder inside a root; without it,
 * `<root>/<number>_<name>` is made (`rootId` may be left out with one root). A project whose folder
 * is there needs `previous`: what happens to that one.
 */
export const projectFolderSchema = z
  .object({
    path: z.string().min(1).optional(),
    rootId: id.optional(),
    previous: z.enum(PROJECT_FOLDER_PREVIOUS).optional(),
  })
  .refine((p) => !(p.path && p.rootId), {
    message: "Give path or rootId, not both",
    path: ["rootId"],
  });

/** Unlink and folder changes: where a trashed folder went. */
export const projectFolderResultSchema = projectDetailSchema.extend({
  trashedTo: z.string().optional(),
});

/** Any subset. Every field sent becomes user-edited. */
export const projectPatchSchema = z
  .object({
    ...editable,
    descriptionFile: nullableText,
    /** Model in the project folder (relative, `/`) shown first; null goes back to the scanner's pick. */
    previewFile: nullableText,
    number: projectSchema.shape.number,
    gallery: projectGallerySchema,
    coverFile: nullableText,
    autoSlice: projectSchema.shape.autoSlice,
    slicerIntegrationId: projectSchema.shape.slicerIntegrationId,
    /** Admins only, and not in a device root (its device's user owns it); null: nobody. */
    ownerId: id.nullable(),
  })
  .partial()
  .strict();

/**
 * Stands for every project the user can't see (ADR-0014), e.g. as a stats breakdown key: the row
 * still counts, without its name.
 */
export const HIDDEN_PROJECT = "ffffffff-ffff-ffff-ffff-ffffffffffff";

/** The listed images the gallery picks show: chosen ones and those under a chosen folder. */
export const galleryImages = (p: {
  gallery: Project["gallery"];
  meta: Pick<Project["meta"], "files">;
}): ProjectFile[] =>
  p.meta.files.filter(
    (f) =>
      f.kind === "image" &&
      (p.gallery.images.includes(f.path) ||
        p.gallery.folders.some((d) => d === "" || f.path.startsWith(`${d}/`))),
  );

export const projectSortFields = ["name", "createdAt", "multicolor", "lastPrintAt"] as const;
/** `name` also searches the description; `material` matches any of the project's materials. */
export const projectFilters = {
  name: { kind: "text" },
  tagId: { kind: "select" },
  collectionId: { kind: "select" },
  /** Projects with a print that took filament from the spool (set by the spool page). */
  spoolId: { kind: "select" },
  material: { kind: "select" },
  multicolor: { kind: "select", options: ["true", "false"] },
  lastPrintAt: { kind: "date" },
  /** See `PROJECT_SLICING`. The file check here is by size only; the project page hashes. */
  slicing: { kind: "select", options: PROJECT_SLICING },
} as const satisfies Record<string, ColumnFilter>;
export const projectListQuery = listQuery(projectSortFields, {}, projectFilters);

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

export const projectOpenSchema = z.object({
  /** `device`: in the slicer of the user's device `deviceId` (a hub root's project only). */
  target: z.enum(["slicer", "folder", "device"]),
  /** Relative to the project folder; must be one of `meta.files`. Slicer and device only. */
  file: z.string().min(1).optional(),
  /** Which integration's slicer; default: `defaultSlicerId`, then the first one. */
  integrationId: z.uuid().optional(),
  deviceId: z.uuid().optional(),
  /** Which of the device's slicers (its id); default: the one its status page picked. */
  slicer: z.string().max(100).optional(),
});

export type ProjectOpen = z.infer<typeof projectOpenSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ProjectFolderInput = z.infer<typeof projectFolderSchema>;
export type ProjectFolderPrevious = (typeof PROJECT_FOLDER_PREVIOUS)[number];
export type ProjectFolderRelease = (typeof PROJECT_FOLDER_RELEASE)[number];
export type ProjectFolderResult = z.infer<typeof projectFolderResultSchema>;
export type ProjectListItem = z.infer<typeof projectListItemSchema>;
export type ProjectMeta = z.infer<typeof projectMetaSchema>;
export type ProjectFile = z.infer<typeof projectFileSchema>;
export type ProjectModel = z.infer<typeof projectModelSchema>;
export type ProjectInput = z.input<typeof projectInputSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
export type ProjectScanStatus = z.infer<typeof projectScanStatusSchema>;
