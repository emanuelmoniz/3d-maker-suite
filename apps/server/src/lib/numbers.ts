import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { HttpError } from "../errors.ts";

const { spools, printers, projects, prints, accessories, quotes, orders } = schema;
// ponytail: all seven have the same `id` and `number` columns; the casts keep one helper typed.
type Numbered =
  | typeof spools
  | typeof printers
  | typeof projects
  | typeof prints
  | typeof accessories
  | typeof quotes
  | typeof orders;
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
  entity: "spool" | "printer" | "project" | "print" | "accessory" | "quote" | "order",
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

/**
 * Digits each number is padded to for display only ("01-A1", "0042-Benchy"); the DB keeps plain
 * numbers. The SQL labels in `lib/catalog.ts` and the web's name helpers use the same widths.
 */
export const PAD = {
  spool: 3,
  printer: 2,
  project: 3,
  print: 4,
  accessory: 2,
  quote: 3,
  order: 3,
} as const;
export const padded = (n: number | null, width: number) => String(n).padStart(width, "0");

/** A printer's display name in JS, the same as the `printerLabel` SQL. */
export const printerTitle = (p: { number: number | null; name: string }) =>
  `${padded(p.number, PAD.printer)}-${p.name}`;

/** An accessory's display name in JS, the same as the `accessoryLabel` SQL. */
export const accessoryTitle = (a: { number: number; name: string }) =>
  `${padded(a.number, PAD.accessory)}-${a.name}`;

/** A print's display name in JS, the same as the `printLabel` SQL. */
export const printTitle = (p: { number: number | null; title: string }) =>
  `${padded(p.number, PAD.print)}-${p.title}`;
