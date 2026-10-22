import { z } from "zod";
import { id } from "./entities.ts";
import { MAINTENANCE_TARGETS, PRINT_OUTCOMES, SPOOL_STATUSES } from "./enums.ts";
import { SLICER_ZIP_TYPES } from "./slicerCatalog.ts";

// File imports (XLSX / CSV). The columns of an entity are declared once here and drive the
// template, the parser, validation and the review table.
export const IMPORT_ENTITIES = [
  "spools",
  "printers",
  "accessories",
  "accessoryInstalls",
  "projects",
  "prints",
  "clients",
  "quotes",
  "orders",
  "maintenanceTypes",
  "maintenance",
  "orderProjects",
  ...SLICER_ZIP_TYPES,
] as const;
/** Everything the review screen takes: every file entity; an integration or a zip offers some. */
export const REVIEW_ENTITIES = IMPORT_ENTITIES;
/** What an integration can offer for review; a run on its own takes only what needs no decision. */
export const REVIEWED_TYPES = ["spools", "prints", ...SLICER_ZIP_TYPES] as const;
export const IMPORT_SOURCES = ["file", "zip", "integration"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];
export type ReviewEntity = (typeof REVIEW_ENTITIES)[number];
export type ReviewedType = (typeof REVIEWED_TYPES)[number];

export const IMPORT_COLUMN_TYPES = [
  "text",
  "number",
  "integer",
  "money",
  "date",
  "datetime",
  "color",
  "enum",
  "ref",
] as const;

export type ImportColumn = {
  /** Stable id: key in `row.values`, accepted as a file header in any language. */
  key: string;
  /**
   * `money` is typed in major units and kept in minor units; `date` is kept as `YYYY-MM-DD` and
   * `datetime` as UTC `YYYY-MM-DDTHH:mm:ssZ`.
   */
  type: (typeof IMPORT_COLUMN_TYPES)[number];
  required?: boolean;
  /** i18n key, written in full so `pnpm i18n:check` sees it. */
  label: string;
  /** `enum`: the allowed values (template dropdown, validation). */
  options?: readonly string[];
  /** `ref`: a name, found or created on apply; the template dropdown lists the ones you have. */
  ref?: string;
  /** Values for `label`'s interpolation (a numbered column: `{ n: 2 }`). */
  labelArgs?: Record<string, number>;
  /** An instruction for the import, not data of the row: it never counts as a difference. */
  fileOnly?: boolean;
};

/**
 * The project pick that means "this print has no project" (a calibration print): never linked to
 * one by its title later. The nil uuid, as picks are ids.
 */
export const NO_PROJECT = "00000000-0000-0000-0000-000000000000";

/** A Bambu AMS setup takes up to 16 spools, so a print has up to 16 filament slots. */
export const PRINT_MAX_SLOTS = 16;

/** The keys of a print's filament slot (1-based). Slot 1 keeps the keys from before there were more. */
export const printSlotKeys = (n: number) =>
  n === 1
    ? { spool: "spool", filament: "filament", grams: "grams" }
    : { spool: `spool${n}`, filament: `filament${n}`, grams: `grams${n}` };

const printSlotColumns = (n: number): ImportColumn[] => [
  {
    key: printSlotKeys(n).spool,
    type: "ref",
    ref: "spools",
    label: "import:prints.columns.spoolN",
    labelArgs: { n },
  },
  {
    key: printSlotKeys(n).filament,
    type: "ref",
    ref: "filamentProfiles",
    label: "import:prints.columns.filamentN",
    labelArgs: { n },
  },
  {
    key: printSlotKeys(n).grams,
    type: "number",
    label: "import:prints.columns.gramsN",
    labelArgs: { n },
  },
];

export const IMPORT_COLUMNS = {
  spools: [
    // A spool's number is its identity in a file: a row with one updates that spool.
    { key: "number", type: "integer", label: "import:spools.columns.number" },
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
    { key: "colorName", type: "text", label: "import:spools.columns.colorName" },
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
  printers: [
    // A printer's number is its identity in a file: a row with one updates that printer.
    { key: "number", type: "integer", label: "import:printers.columns.number" },
    { key: "name", type: "text", label: "import:printers.columns.name", required: true },
    {
      key: "brand",
      type: "ref",
      ref: "brands",
      label: "import:printers.columns.brand",
      required: true,
    },
    {
      key: "model",
      type: "ref",
      ref: "printerModels",
      label: "import:printers.columns.model",
      required: true,
    },
    { key: "serial", type: "text", label: "import:printers.columns.serial" },
    { key: "nozzleDiameterMm", type: "number", label: "import:printers.columns.nozzleDiameterMm" },
    { key: "purchasedAt", type: "date", label: "import:printers.columns.purchasedAt" },
    { key: "purchasePrice", type: "money", label: "import:printers.columns.purchasePrice" },
    { key: "warrantyEndsAt", type: "date", label: "import:printers.columns.warrantyEndsAt" },
    { key: "powerW", type: "integer", label: "import:printers.columns.powerW" },
    // Cost settings; empty on a new printer = the Costs default.
    {
      key: "countInCosts",
      type: "enum",
      options: ["yes", "no"],
      label: "import:printers.columns.countInCosts",
    },
    { key: "lifetimeHours", type: "integer", label: "import:printers.columns.lifetimeHours" },
    {
      key: "includeMaintenanceCost",
      type: "enum",
      options: ["yes", "no"],
      label: "import:printers.columns.includeMaintenanceCost",
    },
  ],
  accessories: [
    // Like printers: the number is its identity in a file.
    { key: "number", type: "integer", label: "import:accessories.columns.number" },
    { key: "name", type: "text", label: "import:accessories.columns.name", required: true },
    { key: "type", type: "text", label: "import:accessories.columns.type", required: true },
    { key: "serial", type: "text", label: "import:accessories.columns.serial" },
    { key: "purchasedAt", type: "date", label: "import:accessories.columns.purchasedAt" },
    { key: "purchasePrice", type: "money", label: "import:accessories.columns.purchasePrice" },
    { key: "warrantyEndsAt", type: "date", label: "import:accessories.columns.warrantyEndsAt" },
    { key: "powerW", type: "integer", label: "import:accessories.columns.powerW" },
    {
      key: "countInCosts",
      type: "enum",
      options: ["yes", "no"],
      label: "import:accessories.columns.countInCosts",
    },
    { key: "lifetimeHours", type: "integer", label: "import:accessories.columns.lifetimeHours" },
    {
      key: "includeMaintenanceCost",
      type: "enum",
      options: ["yes", "no"],
      label: "import:accessories.columns.includeMaintenanceCost",
    },
  ],
  // An install has no number: it is its accessory, printer and install day. Both must exist.
  accessoryInstalls: [
    {
      key: "accessory",
      type: "ref",
      ref: "accessories",
      label: "import:accessoryInstalls.columns.accessory",
      required: true,
    },
    {
      key: "printer",
      type: "ref",
      ref: "printers",
      label: "import:accessoryInstalls.columns.printer",
      required: true,
    },
    {
      key: "installedAt",
      type: "date",
      label: "import:accessoryInstalls.columns.installedAt",
      required: true,
    },
    // Empty = still on the printer.
    { key: "removedAt", type: "date", label: "import:accessoryInstalls.columns.removedAt" },
  ],
  // The number is its identity in a file. The folder is a full path inside a project root; the
  // scan fills in the rest (files, cover, materials) after the apply.
  projects: [
    { key: "number", type: "integer", label: "import:projects.columns.number" },
    { key: "name", type: "text", label: "import:projects.columns.name", required: true },
    { key: "description", type: "text", label: "import:projects.columns.description" },
    { key: "sourceUrl", type: "text", label: "import:projects.columns.sourceUrl" },
    { key: "folder", type: "text", label: "import:projects.columns.folder" },
  ],
  prints: [
    // A print's number is its identity in a file: a row with one updates that print.
    { key: "number", type: "integer", label: "import:prints.columns.number" },
    {
      key: "printer",
      type: "ref",
      ref: "printers",
      label: "import:prints.columns.printer",
      required: true,
    },
    // A project that doesn't exist yet is created, without a folder.
    { key: "project", type: "ref", ref: "projects", label: "import:prints.columns.project" },
    { key: "title", type: "text", label: "import:prints.columns.title", required: true },
    {
      key: "startedAt",
      type: "datetime",
      label: "import:prints.columns.startedAt",
      required: true,
    },
    { key: "durationSec", type: "integer", label: "import:prints.columns.durationSec" },
    {
      key: "outcome",
      type: "enum",
      options: PRINT_OUTCOMES,
      label: "import:prints.columns.outcome",
      required: true,
    },
    { key: "failureReason", type: "text", label: "import:prints.columns.failureReason" },
    { key: "notes", type: "text", label: "import:prints.columns.notes" },
    { key: "spool", type: "ref", ref: "spools", label: "import:prints.columns.spool" },
    {
      key: "filament",
      type: "ref",
      ref: "filamentProfiles",
      label: "import:prints.columns.filament",
    },
    { key: "grams", type: "number", label: "import:prints.columns.grams" },
    // Slots 2..16: a multicolor print has one spool, filament and weight per color.
    ...Array.from({ length: PRINT_MAX_SLOTS - 1 }, (_, i) => printSlotColumns(i + 2)).flat(),
    // "no" saves the print and its filament but leaves the spools' weights alone.
    {
      key: "trackUsage",
      type: "enum",
      options: ["yes", "no"],
      label: "import:prints.columns.trackUsage",
      fileOnly: true,
    },
  ],
  // A client is its mobile (unique), else its email or VAT number; there is no number.
  clients: [
    { key: "name", type: "text", label: "import:clients.columns.name", required: true },
    { key: "mobile", type: "text", label: "import:clients.columns.mobile", required: true },
    { key: "vat", type: "text", label: "import:clients.columns.vat" },
    { key: "email", type: "text", label: "import:clients.columns.email" },
    { key: "address", type: "text", label: "import:clients.columns.address" },
    { key: "notes", type: "text", label: "import:clients.columns.notes" },
  ],
  // A quote from a file is a typed-in print: the production cost of one print, then the pricing.
  // Empty settings on a new quote = the Costs defaults. Client and project must exist.
  quotes: [
    { key: "number", type: "integer", label: "import:quotes.columns.number" },
    { key: "name", type: "text", label: "import:quotes.columns.name", required: true },
    { key: "client", type: "ref", ref: "clients", label: "import:quotes.columns.client" },
    { key: "project", type: "ref", ref: "projects", label: "import:quotes.columns.project" },
    { key: "unitCost", type: "money", label: "import:quotes.columns.unitCost", required: true },
    { key: "quantity", type: "integer", label: "import:quotes.columns.quantity" },
    { key: "laborHours", type: "number", label: "import:quotes.columns.laborHours" },
    { key: "laborRate", type: "money", label: "import:quotes.columns.laborRate" },
    {
      key: "failureMarginPct",
      type: "number",
      label: "import:quotes.columns.failureMarginPct",
    },
    { key: "markupPct", type: "number", label: "import:quotes.columns.markupPct" },
    { key: "notes", type: "text", label: "import:quotes.columns.notes" },
  ],
  // Client, quote and projects must exist; `project` holds one or more, separated by ";".
  orders: [
    { key: "number", type: "integer", label: "import:orders.columns.number" },
    { key: "client", type: "ref", ref: "clients", label: "import:orders.columns.client" },
    { key: "quote", type: "ref", ref: "quotes", label: "import:orders.columns.quote" },
    {
      key: "project",
      type: "ref",
      ref: "projects",
      label: "import:orders.columns.project",
      required: true,
    },
    { key: "price", type: "money", label: "import:orders.columns.price", required: true },
    // One of the order statuses of the preferences; empty on a new order = the first.
    { key: "status", type: "text", label: "import:orders.columns.status" },
    { key: "notes", type: "text", label: "import:orders.columns.notes" },
  ],
  maintenanceTypes: [
    {
      key: "name",
      type: "ref",
      ref: "maintenanceTypes",
      label: "import:maintenanceTypes.columns.name",
      required: true,
    },
    {
      key: "target",
      type: "enum",
      options: MAINTENANCE_TARGETS,
      label: "import:maintenanceTypes.columns.target",
      required: true,
    },
    { key: "description", type: "text", label: "import:maintenanceTypes.columns.description" },
    { key: "docUrl", type: "text", label: "import:maintenanceTypes.columns.docUrl" },
    { key: "intervalDays", type: "integer", label: "import:maintenanceTypes.columns.intervalDays" },
    {
      key: "intervalHours",
      type: "number",
      label: "import:maintenanceTypes.columns.intervalHours",
    },
    {
      key: "intervalPrints",
      type: "integer",
      label: "import:maintenanceTypes.columns.intervalPrints",
    },
    { key: "warnLeadDays", type: "integer", label: "import:maintenanceTypes.columns.warnLeadDays" },
    {
      key: "warnLeadHours",
      type: "integer",
      label: "import:maintenanceTypes.columns.warnLeadHours",
    },
    {
      key: "warnLeadPrints",
      type: "integer",
      label: "import:maintenanceTypes.columns.warnLeadPrints",
    },
    // Empty = the default of the maintenance settings.
    {
      key: "warnEnabled",
      type: "enum",
      options: ["yes", "no"],
      label: "import:maintenanceTypes.columns.warnEnabled",
    },
    {
      key: "errorEnabled",
      type: "enum",
      options: ["yes", "no"],
      label: "import:maintenanceTypes.columns.errorEnabled",
    },
    // `;` lists of names: models ("Bambu Lab X1C"), printers and accessories (by number or name).
    { key: "models", type: "text", label: "import:maintenanceTypes.columns.models" },
    { key: "printers", type: "text", label: "import:maintenanceTypes.columns.printers" },
    {
      key: "accessoryTypes",
      type: "text",
      label: "import:maintenanceTypes.columns.accessoryTypes",
    },
    { key: "accessories", type: "text", label: "import:maintenanceTypes.columns.accessories" },
  ],
  // A task is its type, its printer or accessory and the time it was done.
  maintenance: [
    {
      key: "type",
      type: "ref",
      ref: "maintenanceTypes",
      label: "import:maintenance.columns.type",
      required: true,
    },
    {
      key: "printer",
      type: "ref",
      ref: "printers",
      label: "import:maintenance.columns.printer",
    },
    {
      key: "accessory",
      type: "ref",
      ref: "accessories",
      label: "import:maintenance.columns.accessory",
    },
    {
      key: "doneAt",
      type: "datetime",
      label: "import:maintenance.columns.doneAt",
      required: true,
    },
    // Empty = the target's usage at that time, as the API works it out.
    { key: "runtimeHoursAt", type: "number", label: "import:maintenance.columns.runtimeHoursAt" },
    { key: "printsAt", type: "integer", label: "import:maintenance.columns.printsAt" },
    { key: "cost", type: "money", label: "import:maintenance.columns.cost" },
    { key: "notes", type: "text", label: "import:maintenance.columns.notes" },
  ],
  orderProjects: [
    { key: "order", type: "integer", label: "import:orderProjects.columns.order", required: true },
    {
      key: "project",
      type: "ref",
      ref: "projects",
      label: "import:orderProjects.columns.project",
      required: true,
    },
  ],
  // A name that is the row's identity is a `ref`, so its spelling alone is never a difference.
  filamentProfiles: [
    {
      key: "brand",
      type: "ref",
      ref: "filamentBrands",
      label: "import:filamentProfiles.columns.brand",
    },
    {
      key: "material",
      type: "ref",
      ref: "filamentMaterials",
      label: "import:filamentProfiles.columns.material",
      required: true,
    },
    {
      key: "name",
      type: "ref",
      ref: "filamentProfiles",
      label: "import:filamentProfiles.columns.name",
    },
    { key: "diameterMm", type: "number", label: "import:filamentProfiles.columns.diameterMm" },
    {
      key: "densityGcm3",
      type: "number",
      label: "import:filamentProfiles.columns.densityGcm3",
      required: true,
    },
    { key: "pricePerKg", type: "money", label: "import:filamentProfiles.columns.pricePerKg" },
    { key: "nozzleTempC", type: "integer", label: "import:filamentProfiles.columns.nozzleTempC" },
    { key: "bedTempC", type: "integer", label: "import:filamentProfiles.columns.bedTempC" },
  ],
  brands: [
    {
      key: "name",
      type: "ref",
      ref: "brands",
      label: "import:brands.columns.name",
      required: true,
    },
  ],
  printerModels: [
    {
      key: "brand",
      type: "ref",
      ref: "brands",
      label: "import:printerModels.columns.brand",
      required: true,
    },
    {
      key: "model",
      type: "ref",
      ref: "printerModels",
      label: "import:printerModels.columns.model",
      required: true,
    },
    // "yes" = the source ships a picture; it only ever fills a model that has none.
    {
      key: "thumbnail",
      type: "enum",
      options: ["yes"],
      label: "import:printerModels.columns.thumbnail",
    },
  ],
  machineProfiles: [
    {
      key: "brand",
      type: "ref",
      ref: "brands",
      label: "import:machineProfiles.columns.brand",
      required: true,
    },
    {
      key: "model",
      type: "ref",
      ref: "printerModels",
      label: "import:machineProfiles.columns.model",
      required: true,
    },
    { key: "name", type: "text", label: "import:machineProfiles.columns.name", required: true },
    {
      key: "nozzleDiameterMm",
      type: "number",
      label: "import:machineProfiles.columns.nozzleDiameterMm",
      required: true,
    },
  ],
  // Brand and model are optional: a process preset can name no printer we know.
  printProfiles: [
    { key: "brand", type: "ref", ref: "brands", label: "import:printProfiles.columns.brand" },
    {
      key: "model",
      type: "ref",
      ref: "printerModels",
      label: "import:printProfiles.columns.model",
    },
    { key: "name", type: "text", label: "import:printProfiles.columns.name", required: true },
    {
      key: "nozzleDiameterMm",
      type: "number",
      label: "import:printProfiles.columns.nozzleDiameterMm",
    },
    { key: "layerHeightMm", type: "number", label: "import:printProfiles.columns.layerHeightMm" },
  ],
  filamentBrands: [
    {
      key: "name",
      type: "ref",
      ref: "filamentBrands",
      label: "import:filamentBrands.columns.name",
      required: true,
    },
    { key: "url", type: "text", label: "import:filamentBrands.columns.url" },
  ],
  filamentMaterials: [
    {
      key: "name",
      type: "ref",
      ref: "filamentMaterials",
      label: "import:filamentMaterials.columns.name",
      required: true,
    },
    { key: "nozzleTempC", type: "integer", label: "import:filamentMaterials.columns.nozzleTempC" },
    { key: "bedTempC", type: "integer", label: "import:filamentMaterials.columns.bedTempC" },
    { key: "densityGcm3", type: "number", label: "import:filamentMaterials.columns.densityGcm3" },
  ],
} as const satisfies Record<ReviewEntity, readonly ImportColumn[]>;

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
  "not_a_datetime",
  "not_a_color",
  "not_an_option",
  "not_an_email",
  /** A name that must already exist (a print's printer) matches nothing, or too much. */
  "unresolved",
  /** A print's spool was opened after the print started (`usableOn`). */
  "not_opened",
  /** An install's removal is before its install day. */
  "before_install",
  /** The accessory is on a printer during that period already. */
  "overlap",
  /** A maintenance row needs exactly one printer or accessory, the one its type is for. */
  "wrong_target",
  /** A project's folder isn't inside a project root. */
  "outside_roots",
  /** Another project (or an earlier row of the file) has that folder. */
  "folder_in_use",
] as const;

const cell = z.union([z.string(), z.number(), z.null()]);
/** A row's parsed values by column key. An empty cell is `null`. */
const values = z.record(z.string(), cell);

export const importPreviewRowSchema = z.object({
  /** Line in the file (the header is 1); decisions refer to it. */
  row: z.number().int().positive(),
  values,
  /** The row's cells as the file has them (plus `id`), so the review can show and edit them. */
  raw: values,
  status: z.enum(IMPORT_STATUSES),
  /** Why the row is `invalid`. */
  errors: z.array(z.object({ column: z.string(), code: z.enum(IMPORT_ERRORS) })),
  /** The suggested match; null = left for the user. */
  targetId: id.nullable(),
  /** The existing rows that fit (`ambiguous` has several). */
  candidates: z.array(id),
  /** The suggested action. */
  action: z.enum(IMPORT_ACTIONS),
  /** By column key: the existing row suggested for a reference the user picks (null = none fits). */
  refs: z.record(z.string(), id.nullable()).optional(),
  /** Keys of `refs` picked from several that fit (e.g. two spools of one colour): to check. */
  refsUnsure: z.array(z.string()).optional(),
  /** By key of `refs`: the options that fit the row (a slot's material + colour), listed first. */
  refsFirst: z.record(z.string(), z.array(id)).optional(),
  /**
   * Rows from an integration: what a run with nobody watching does. `apply` takes the suggestion,
   * `wait` leaves the row for a person; absent = neither (nothing to do, or only on request).
   */
  auto: z.enum(["apply", "wait"]).optional(),
  /** Projects: the row names a folder that doesn't exist (yet). */
  folderMissing: z.boolean().optional(),
});

export const importPreviewSchema = z.object({
  uploadId: z.uuid(),
  entity: z.enum(REVIEW_ENTITIES),
  /** The folder an integration read its rows from. */
  dir: z.string().optional(),
  /**
   * By column key: the rows a picked reference can be. Creating a row then needs a pick. A spool
   * says when it was opened (`from`, offered for rows from that day on) and if it is `empty`
   * (offered only to a row that names it).
   */
  refOptions: z
    .record(
      z.string(),
      z.array(
        z.object({
          id,
          label: z.string(),
          from: z.string().optional(),
          empty: z.boolean().optional(),
        }),
      ),
    )
    .optional(),
  /**
   * A row is offered the picks its `refs` name. These keys may stay empty (a print's spool slots);
   * any other offered pick is needed to create the row (a print's project).
   */
  refsOptional: z.array(z.string()).optional(),
  rows: z.array(importPreviewRowSchema),
  /** Existing rows in the same column shape, for the target picker and the diff. */
  targets: z.array(z.object({ id, label: z.string(), values })),
  /** By `ref`: names in the file you don't have yet. Apply creates them. */
  missing: z.record(z.string(), z.array(z.string())),
  /** File columns that match no column of the entity. */
  ignoredHeaders: z.array(z.string()),
  /** A file's column keys in the file's order (`id` included); absent when no file was read. */
  columns: z.array(z.string()).optional(),
  /** By `ref`: the names you have, offered when a cell is edited. */
  refNames: z.record(z.string(), z.array(z.string())),
});

/** What the template and the export are written as. */
export const SHEET_FORMATS = ["xlsx", "csv", "json"] as const;
export type SheetFormat = (typeof SHEET_FORMATS)[number];

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
  fileName: z.string().max(255).optional(),
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
        /** By column key: the picked references (see `refOptions`). */
        refs: z.record(z.string(), id).optional(),
        /**
         * Prints: false saves the print and its filament without taking it from the spools;
         * replaces the row's `trackUsage`.
         */
        trackUsage: z.boolean().optional(),
        /**
         * Projects: replaces the row's folder. A picked folder, one to make inside a project root
         * (`name` empty = `<number>_<name>`, `root` needed with several roots), or null for none.
         */
        folder: z
          .union([
            z.object({ path: z.string().min(1) }),
            z.object({
              create: z.literal(true),
              name: z.string().max(200).optional(),
              root: z.string().min(1).optional(),
            }),
          ])
          .nullable()
          .optional(),
        /** Projects: name, description and link come from the folder's scan, not the file. */
        fromFolder: z.boolean().optional(),
        /** Projects: exactly these prints are the project's; absent = linked automatically. */
        prints: z.array(id).max(10000).optional(),
        /**
         * Cells edited in the review, by column key, as a file cell would hold them. They replace
         * the row's cells and the row is validated again; `id` and `number` can't change on an
         * update.
         */
        values: values.optional(),
      }),
    )
    .min(1),
});

export const importProjectPrintsSchema = z.object({
  rows: z
    .array(
      z.object({
        row: z.number().int().positive(),
        targetId: id.nullable().optional(),
        folder: z.string().nullable().optional(),
      }),
    )
    .max(20000),
});
export const importProjectPrintsResponseSchema = z.object({
  /** By file row: the prints the project gets, as linking would give them after the import. */
  suggested: z.record(z.string(), z.array(id)),
  /** Every print, for adding one by hand. */
  prints: z.array(z.object({ id, label: z.string() })),
});

export const importResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  /** The automatic backup taken just before. */
  backup: z.string(),
});

export const importRunSchema = z.object({
  id,
  source: z.enum(IMPORT_SOURCES),
  type: z.string(),
  fileName: z.string().nullable(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  invalid: z.number().int(),
  errors: z.array(z.object({ row: z.number(), column: z.string(), code: z.string() })).nullable(),
  backup: z.string().nullable(),
  createdAt: z.string(),
});

export type ImportRun = z.infer<typeof importRunSchema>;
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
export type ImportApplyDecision = ImportApply["decisions"][number];
export type ImportResult = z.infer<typeof importResultSchema>;
