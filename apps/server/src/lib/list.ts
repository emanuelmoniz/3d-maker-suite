import type { DateRangeQuery, Page, PaginationQuery } from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import { type AnyColumn, and, asc, count, desc, gte, inArray, lt, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/** `column IN ids`, or nothing when the filter is absent (drop-in for `where` arrays). */
export const inIds = (column: AnyColumn, ids?: string[]) =>
  ids ? inArray(column, ids) : undefined;

/** `from <= column < to` on a UTC ISO-string column. Reusable by stats queries. */
export const dateRange = (column: AnyColumn, { from, to }: DateRangeQuery) =>
  and(from ? gte(column, from) : undefined, to ? lt(column, to) : undefined);

/** Maps `?sort=-name` onto a whitelisted column map. */
export function orderBy(columns: Record<string, AnyColumn>, sort: string) {
  const desc_ = sort.startsWith("-");
  const column = columns[desc_ ? sort.slice(1) : sort];
  if (!column) throw new Error(`Unknown sort field: ${sort}`);
  return (desc_ ? desc : asc)(column);
}

export interface ListOptions {
  /** Sortable fields (API name -> column). The first key is the default, ascending. */
  sort: Record<string, AnyColumn>;
  /** Column the `from`/`to` range applies to. Omit if the table has no date filter. */
  dateColumn?: AnyColumn;
  /** Entity filters, already built with `inIds`/`eq`; undefined entries are ignored. */
  where?: (SQL | undefined)[];
}

/** One-stop list endpoint: filters + sort + pagination + total. */
export function listPage<T extends SQLiteTable>(
  db: Db,
  table: T,
  q: PaginationQuery & DateRangeQuery & { sort?: string },
  o: ListOptions,
): Page<T["$inferSelect"]> {
  const where = and(...(o.where ?? []), o.dateColumn && dateRange(o.dateColumn, q));
  const defaultSort = Object.keys(o.sort)[0] as string;
  const items = db
    .select()
    .from(table as SQLiteTable)
    .where(where)
    .orderBy(orderBy(o.sort, q.sort ?? defaultSort))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
    .all() as T["$inferSelect"][];
  const total =
    db
      .select({ n: count() })
      .from(table as SQLiteTable)
      .where(where)
      .get()?.n ?? 0;
  return { items, page: q.page, pageSize: q.pageSize, total };
}
