import { z } from "zod";
import { id } from "./entities.ts";
import { SPOOL_STATUSES } from "./enums.ts";

// File imports (XLSX / CSV). The columns of an entity are declared once here and drive the
// template, the parser, validation and the review table.
export const IMPORT_ENTITIES = ["spools"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const IMPORT_COLUMN_TYPES = [
  "text",
  "number",
  "integer",
  "money",
  "date",
  "color",
  "enum",
  "ref",
] as const;

export type ImportColumn = {
  /** Stable id: key in `row.values`, accepted as a file header in any language. */
  key: string;
  /** `money` is typed in major units and kept in minor units; `date` is kept as `YYYY-MM-DD`. */
  type: (typeof IMPORT_COLUMN_TYPES)[number];
  required?: boolean;
  /** i18n key, written in full so `pnpm i18n:check` sees it. */
  label: string;
  /** `enum`: the allowed values (template dropdown, validation). */
  options?: readonly string[];
  /** `ref`: a name, found or created on apply; the template dropdown lists the ones you have. */
  ref?: string;
};

export const IMPORT_COLUMNS = {
  spools: [
    { key: "brand", type: "ref", ref: "filamentBrands", label: "import:spools.columns.brand" },
    {
      key: "material",
      type: "ref",
      ref: "filamentMaterials",
      label: "import:spools.columns.material",
      required: true,
    },
    {
      key: "profile",
      type: "ref",
      ref: "filamentProfiles",
      label: "import:spools.columns.profile",
    },
    { key: "colorHex", type: "color", label: "import:spools.columns.colorHex" },
    {
      key: "initialGrams",
      type: "number",
      label: "import:spools.columns.initialGrams",
      required: true,
    },
    { key: "remainingGrams", type: "number", label: "import:spools.columns.remainingGrams" },
    { key: "emptyWeightGrams", type: "number", label: "import:spools.columns.emptyWeightGrams" },
    { key: "pricePaid", type: "money", label: "import:spools.columns.pricePaid" },
    { key: "purchasedAt", type: "date", label: "import:spools.columns.purchasedAt" },
    { key: "openedAt", type: "date", label: "import:spools.columns.openedAt" },
    { key: "location", type: "text", label: "import:spools.columns.location" },
    {
      key: "status",
      type: "enum",
      options: SPOOL_STATUSES,
      label: "import:spools.columns.status",
    },
  ],
} as const satisfies Record<ImportEntity, readonly ImportColumn[]>;

/**
 * `new`: nothing you have fits; `identical` / `changed`: exactly one row fits; `ambiguous`: several
 * fit, so a person picks; `invalid`: the row failed validation and can't be imported.
 */
export const IMPORT_STATUSES = ["new", "identical", "changed", "ambiguous", "invalid"] as const;
export const IMPORT_ACTIONS = ["create", "update", "skip"] as const;
/** On update: `overwrite` = file values win; `fill` = only fields that are empty are set. */
export const MERGE_POLICIES = ["overwrite", "fill"] as const;
export const IMPORT_ERRORS = [
  "required",
  "not_a_number",
  "negative",
  "not_a_date",
  "not_a_color",
  "not_an_option",
] as const;

const cell = z.union([z.string(), z.number(), z.null()]);
/** A row's parsed values by column key. An empty cell is `null`. */
const values = z.record(z.string(), cell);

export const importPreviewRowSchema = z.object({
  /** Line in the file (the header is 1); decisions refer to it. */
  row: z.number().int().positive(),
  values,
  status: z.enum(IMPORT_STATUSES),
  /** Why the row is `invalid`. */
  errors: z.array(z.object({ column: z.string(), code: z.enum(IMPORT_ERRORS) })),
  /** The suggested match; null = left for the user. */
  targetId: id.nullable(),
  /** The existing rows that fit (`ambiguous` has several). */
  candidates: z.array(id),
  /** The suggested action. */
  action: z.enum(IMPORT_ACTIONS),
});

export const importPreviewSchema = z.object({
  uploadId: z.uuid(),
  rows: z.array(importPreviewRowSchema),
  /** Existing rows in the same column shape, for the target picker and the diff. */
  targets: z.array(z.object({ id, label: z.string(), values })),
  /** By `ref`: names in the file you don't have yet. Apply creates them. */
  missing: z.record(z.string(), z.array(z.string())),
  /** File columns that match no column of the entity. */
  ignoredHeaders: z.array(z.string()),
});

/** Translated header per column key. The server has no translations, so the web sends them. */
const labels = z.record(z.string(), z.string());

export const importTemplateSchema = z.object({
  labels,
  sheets: z.object({
    data: z.string().min(1),
    lists: z.string().min(1),
    instructions: z.string().min(1),
  }),
  /** Rows of the instructions sheet. */
  instructions: z.array(z.array(z.string())),
});

export const importPreviewQuerySchema = z.object({
  /** JSON object of the translated headers, so a file with those headers maps back to keys. */
  labels: z
    .string()
    .default("{}")
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "labels must be JSON" });
        return z.NEVER;
      }
    })
    .pipe(labels),
});

export const importApplySchema = z.object({
  uploadId: z.uuid(),
  policy: z.enum(MERGE_POLICIES),
  /** Skipped rows are left out. The rows themselves are re-read from the stored upload. */
  decisions: z
    .array(
      z.object({
        row: z.number().int().positive(),
        action: z.enum(["create", "update"]),
        /** Required for `update`. */
        targetId: id.optional(),
        /** Overrides `policy` for this row. */
        policy: z.enum(MERGE_POLICIES).optional(),
      }),
    )
    .min(1),
});

export const importResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  /** The automatic backup taken just before. */
  backup: z.string(),
});

export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export type ImportAction = (typeof IMPORT_ACTIONS)[number];
export type MergePolicy = (typeof MERGE_POLICIES)[number];
export type ImportErrorCode = (typeof IMPORT_ERRORS)[number];
export type ImportCell = z.infer<typeof cell>;
export type ImportValues = z.infer<typeof values>;
export type ImportPreviewRow = z.infer<typeof importPreviewRowSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ImportTarget = ImportPreview["targets"][number];
export type ImportTemplate = z.infer<typeof importTemplateSchema>;
export type ImportApply = z.infer<typeof importApplySchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
