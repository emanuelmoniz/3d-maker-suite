import { z } from "zod";
import type { PermissionModule } from "./roles.ts";

// Shared by API validation, OpenAPI and the frontend. Query-string friendly (everything coerces).

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const isoDay = z.union([z.iso.datetime(), z.iso.date()]);

/** `from` inclusive, `to` exclusive. A date-only `to` ("2026-03-31") includes that whole day. */
export const dateRangeQuery = z.object({
  from: isoDay.transform((v) => toIso(v)).optional(),
  to: isoDay.transform((v) => toIso(v, true)).optional(),
});

function toIso(v: string, endOfDay = false) {
  const d = new Date(v);
  if (endOfDay && v.length === 10) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

const listOf = (item: z.ZodType<string, string>) =>
  z
    .string()
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(item).min(1).max(100));

/** Comma-separated ids in the query string: `?printerId=a,b` -> ["a", "b"]. */
export const idList = listOf(z.string());

/** Lists leave archived rows out: `true` lists only those, `all` both (to name what a row points at). */
export const archivedFilter = z.enum(["true", "false", "all"]).default("false");

/** A per-column filter. The same declaration builds the API query schema and the table's filter UI. */
export type ColumnFilter =
  | { kind: "text" } // ?title=benchy -> contains, case-insensitive
  | { kind: "select"; options?: readonly [string, ...string[]] } // ?outcome=a,b -> IN; no options = ids
  | { kind: "number" } // ?durationSec=600..3600, either side optional
  | { kind: "date" }; // ?startedAt=2026-01-01..2026-03-31, same rules as dateRangeQuery

/** `"a..b"` -> [a, b], an empty side is undefined. */
const rangeParts = z
  .string()
  .max(100)
  .transform((v, ctx) => {
    const [a, b, ...rest] = v.split("..");
    if (b !== undefined && !rest.length)
      return [a || undefined, b || undefined] as [string?, string?];
    ctx.addIssue({ code: "custom", message: "Expected a range like a..b" });
    return z.NEVER;
  });

const textFilter = z.string().trim().min(1).max(200);
const num = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .transform(Number);
const numberRange = rangeParts
  .pipe(z.tuple([num.optional(), num.optional()]))
  .transform(([min, max]) => ({ min, max }));
const dateRangeFilter = rangeParts
  .pipe(z.tuple([isoDay.optional(), isoDay.optional()]))
  .transform(([from, to]) => ({ from: from && toIso(from), to: to && toIso(to, true) }));

type FilterSchema<C extends ColumnFilter> = C extends { kind: "text" }
  ? typeof textFilter
  : C extends { kind: "number" }
    ? typeof numberRange
    : C extends { kind: "date" }
      ? typeof dateRangeFilter
      : typeof idList;

export function filterSchema<C extends ColumnFilter>(f: C): FilterSchema<C> {
  const schemas = {
    text: textFilter,
    number: numberRange,
    date: dateRangeFilter,
    select: f.kind === "select" && f.options ? listOf(z.enum(f.options)) : idList,
  };
  return schemas[f.kind] as FilterSchema<C>;
}

/** `?sort=name` ascending, `?sort=-createdAt` descending. */
export const sortQuery = <const F extends readonly [string, ...string[]]>(fields: F) =>
  z.object({ sort: z.enum([...fields, ...fields.map((f) => `-${f}` as const)]).optional() });

/**
 * Pagination + sort + date range + entity filters (e.g. `{ printerId: idList.optional() }`)
 * + column filters (e.g. `printFilters`), each an optional query param.
 */
export function listQuery<
  const F extends readonly [string, ...string[]],
  S extends z.ZodRawShape = Record<never, never>,
  C extends Record<string, ColumnFilter> = Record<never, never>,
>(sortFields: F, filters?: S, columns?: C) {
  const cols = Object.fromEntries(
    Object.entries(columns ?? {}).map(([k, f]) => [k, filterSchema(f).optional()]),
  ) as { [K in keyof C]: z.ZodOptional<FilterSchema<C[K]>> };
  return paginationQuery
    .extend(dateRangeQuery.shape)
    .extend(sortQuery(sortFields).shape)
    .extend((filters ?? {}) as S)
    .extend(cols);
}

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

/** What can stand in the way of a delete: the web's key for its plurals and links (ADR-0018). */
export const DEPENDENT_TYPES = [
  "printerModel",
  "machineProfile",
  "printProfile",
  "printer",
  "accessory",
  "maintenanceType",
  "maintenanceTask",
  "filamentProfile",
  "spool",
  "print",
  "order",
  "quote",
] as const;

/**
 * `details` of an `in_use` error. `total` and `archived` count every row of the type; `items` holds
 * at most 20 the caller may read, active ones first.
 */
export const inUseDetailsSchema = z.object({
  dependents: z.array(
    z.object({
      type: z.enum(DEPENDENT_TYPES),
      total: z.number().int(),
      archived: z.number().int(),
      items: z.array(z.object({ id: z.string(), label: z.string(), archived: z.boolean() })),
    }),
  ),
});

/** The 16 entities of ADR-0018: where a row's `PATCH` and `DELETE` live, and who may bulk them. */
export const BULK_ITEMS = {
  printers: { path: "/api/printers", module: "printers" },
  accessories: { path: "/api/accessories", module: "printers" },
  "maintenance-types": { path: "/api/maintenance/types", module: "maintenance" },
  brands: { path: "/api/brands", module: "printers" },
  "printer-models": { path: "/api/printer-models", module: "printers" },
  "machine-profiles": { path: "/api/machine-profiles", module: "printers" },
  "print-profiles": { path: "/api/print-profiles", module: "printers" },
  spools: { path: "/api/filament/spools", module: "filament" },
  "filament-brands": { path: "/api/filament-brands", module: "filament" },
  "filament-materials": { path: "/api/filament-materials", module: "filament" },
  "filament-profiles": { path: "/api/filament/profiles", module: "filament" },
  projects: { path: "/api/projects", module: "projects" },
  prints: { path: "/api/prints", module: "prints" },
  orders: { path: "/api/orders", module: "costs" },
  quotes: { path: "/api/costs/quotes", module: "costs" },
  clients: { path: "/api/clients", module: "costs" },
} as const satisfies Record<string, { path: string; module: PermissionModule }>;

export type BulkKind = keyof typeof BULK_ITEMS;
export const bulkKindSchema = z.enum(Object.keys(BULK_ITEMS) as [BulkKind, ...BulkKind[]]);

/** The API's largest page: a selection is one page's rows. */
export const BULK_MAX_IDS = 100;

export const bulkInputSchema = z.object({
  action: z.enum(["archive", "restore", "delete"]),
  ids: z.array(z.uuid()).min(1).max(BULK_MAX_IDS),
});

/** What happened to each row; `blocked` carries the error its single-row request would get. */
export const bulkResultSchema = z.object({
  done: z.array(z.string()),
  blocked: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      message: z.string(),
      details: inUseDetailsSchema.optional(),
    }),
  ),
});

export type BulkItemAction = z.infer<typeof bulkInputSchema>["action"];
export type BulkResult = z.infer<typeof bulkResultSchema>;
export type DependentType = (typeof DEPENDENT_TYPES)[number];
export type InUseDetails = z.infer<typeof inUseDetailsSchema>;
export type PaginationQuery = z.infer<typeof paginationQuery>;
export type DateRangeQuery = z.infer<typeof dateRangeQuery>;
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
export type ApiError = z.infer<typeof apiErrorSchema>;
