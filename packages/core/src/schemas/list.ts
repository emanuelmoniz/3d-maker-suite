import { z } from "zod";

// Shared by API validation, OpenAPI and the frontend. Query-string friendly (everything coerces).

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** `from` inclusive, `to` exclusive. A date-only `to` ("2026-03-31") includes that whole day. */
export const dateRangeQuery = z.object({
  from: z
    .union([z.iso.datetime(), z.iso.date()])
    .transform((v) => toIso(v))
    .optional(),
  to: z
    .union([z.iso.datetime(), z.iso.date()])
    .transform((v) => toIso(v, true))
    .optional(),
});

function toIso(v: string, endOfDay = false) {
  const d = new Date(v);
  if (endOfDay && v.length === 10) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Comma-separated ids in the query string: `?printerId=a,b` -> ["a", "b"]. */
export const idList = z
  .string()
  .transform((v) => v.split(",").filter(Boolean))
  .pipe(z.array(z.string()).min(1).max(100));

/** `?sort=name` ascending, `?sort=-createdAt` descending. */
export const sortQuery = <const F extends readonly [string, ...string[]]>(fields: F) =>
  z.object({ sort: z.enum([...fields, ...fields.map((f) => `-${f}` as const)]).optional() });

/** Pagination + sort + date range + entity filters (e.g. `{ printerId: idList.optional() }`). */
export function listQuery<
  const F extends readonly [string, ...string[]],
  S extends z.ZodRawShape = Record<never, never>,
>(sortFields: F, filters?: S) {
  return paginationQuery
    .extend(dateRangeQuery.shape)
    .extend(sortQuery(sortFields).shape)
    .extend((filters ?? {}) as S);
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

export type PaginationQuery = z.infer<typeof paginationQuery>;
export type DateRangeQuery = z.infer<typeof dateRangeQuery>;
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
export type ApiError = z.infer<typeof apiErrorSchema>;
