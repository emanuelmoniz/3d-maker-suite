import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { HttpError } from "../errors.ts";

const { spools, printers, projects } = schema;
// ponytail: all three have the same `id` and `number` columns; the casts keep one helper typed.
type Numbered = typeof spools | typeof printers | typeof projects;
const asSpools = (t: Numbered) => t as typeof spools;

/** An import cell as an entity number: a positive whole number, else null ("use the next free one"). */
export const numberCell = (c: unknown) =>
  typeof c === "number" && Number.isInteger(c) && c > 0 ? c : null;

/** The next free number as an INSERT value: max + 1, 1 for the first row. */
export const nextNumber = (table: Numbered) =>
  sql<number>`(SELECT coalesce(max(${asSpools(table).number}), 0) + 1 FROM ${table})`;

/** `number` if no row of `table` has it, else null (the caller then takes the next free one). */
export const freeNumber = (db: Db, table: Numbered, number: number | null) => {
  const t = asSpools(table);
  return number != null && db.select({ id: t.id }).from(t).where(eq(t.number, number)).get()
    ? null
    : number;
};

/** Throws a 409 `<entity>_number_taken` when another row of `table` already has `number`. */
export function assertNumberFree(
  db: Db,
  table: Numbered,
  entity: "spool" | "printer" | "project",
  number: number | null | undefined,
  exceptId?: string,
) {
  if (number == null) return;
  const t = asSpools(table);
  const other = db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.number, number), exceptId ? ne(t.id, exceptId) : undefined))
    .get();
  if (other) throw new HttpError(409, `${entity}_number_taken`, `Number ${number} is taken`);
}

/** A printer's display name in JS, the same as the `printerLabel` SQL. */
export const printerTitle = (p: { number: number | null; name: string }) => `${p.number}-${p.name}`;
