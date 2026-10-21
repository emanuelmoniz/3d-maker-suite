import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import { HttpError } from "../errors.ts";

const { accessoryInstalls: installs } = schema;

/** An install of the accessory that overlaps the period `[start, end)` (end null = still on). */
export const findOverlap = (
  db: Db,
  accessoryId: string,
  start: string,
  end: string | null,
  exceptId?: string,
) =>
  db
    .select({ id: installs.id })
    .from(installs)
    .where(
      and(
        eq(installs.accessoryId, accessoryId),
        exceptId ? ne(installs.id, exceptId) : undefined,
        end === null ? undefined : lt(installs.installedAt, end),
        or(isNull(installs.removedAt), gt(installs.removedAt, start)),
      ),
    )
    .get();

/** Refuses a period that ends before it starts or overlaps another install of the accessory. */
export function assertPeriod(
  db: Db,
  accessoryId: string,
  start: string,
  end: string | null,
  exceptId?: string,
) {
  if (end !== null && end < start)
    throw new HttpError(400, "invalid_dates", "Removal is before the install");
  if (findOverlap(db, accessoryId, start, end, exceptId))
    throw new HttpError(409, "install_overlap", "It is on a printer during that period");
}
