import {
  type ImportCell,
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  matchRowsOn,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq } from "drizzle-orm";
import { assertPeriod, findOverlap } from "../lib/installs.ts";
import { accessoryTitle, printerTitle } from "../lib/numbers.ts";
import { find, type Ref, refOf } from "./prints.ts";

const { accessories, accessoryInstalls: installs, printers } = schema;

// Dates are kept as noon UTC, like the install dialog does.
const noon = (c: ImportCell | undefined) =>
  typeof c === "string" ? new Date(`${c}T12:00:00Z`).toISOString() : null;
const day = (iso: string | null) => iso?.slice(0, 10) ?? null;

type Look = { accessories: Ref; printers: Ref };
function build(db: Db): Look {
  return {
    accessories: refOf(
      db
        .select()
        .from(accessories)
        .all()
        .map((a) => ({ ...a, keys: [accessoryTitle(a), a.name] })),
    ),
    printers: refOf(
      db
        .select()
        .from(printers)
        .all()
        .map((p) => ({ ...p, keys: [printerTitle(p), p.name] })),
    ),
  };
}
// A preview or an apply runs in one synchronous stretch (see `lookups` in prints.ts).
let cached: { db: Db; look: Look } | null = null;
function lookups(db: Db): Look {
  if (cached?.db !== db) {
    cached = { db, look: build(db) };
    queueMicrotask(() => {
      cached = null;
    });
  }
  return cached.look;
}

/** The cell as the display name of the row it means (the spelling the targets use). */
const label = (ref: Ref, c: ImportCell | undefined) => {
  const id = find(ref, c);
  return (id && ref.labels.get(id)) || (c ?? null);
};

/**
 * Accessory installs from a file: an accessory on a printer from one day to another (empty = still
 * on). An install is its accessory, printer and install day; the accessory and printer must exist.
 */
export const installImport = {
  /** Every install, in the shape of the import columns. */
  targets: (db: Db): ImportTarget[] =>
    db
      .select({ install: installs, accessory: accessories, printer: printers })
      .from(installs)
      .innerJoin(accessories, eq(accessories.id, installs.accessoryId))
      .innerJoin(printers, eq(printers.id, installs.printerId))
      .orderBy(asc(accessories.number), asc(installs.installedAt))
      .all()
      .map(({ install: i, accessory, printer }) => ({
        id: i.id,
        label: `${accessoryTitle(accessory)} · ${printerTitle(printer)}`,
        values: {
          accessory: accessoryTitle(accessory),
          printer: printerTitle(printer),
          installedAt: day(i.installedAt),
          removedAt: day(i.removedAt),
        },
      })),

  match: matchRowsOn("accessory", "printer", "installedAt"),

  /** Each accessory and printer cell that resolves becomes its display name, as the targets use. */
  canon(db: Db, v: ImportValues): ImportValues {
    const look = lookups(db);
    return {
      ...v,
      accessory: label(look.accessories, v.accessory),
      printer: label(look.printers, v.printer),
    };
  },

  refs: (db: Db) => ({
    accessories: [...lookups(db).accessories.labels.values()],
    printers: [...lookups(db).printers.labels.values()],
  }),

  missing: () => ({}),

  /** The same rules as the API: both exist, no removal before the install, no overlap. */
  check(db: Db, v: ImportValues) {
    const look = lookups(db);
    const errors: { column: string; code: ImportErrorCode }[] = [];
    const accessoryId = find(look.accessories, v.accessory);
    const printerId = find(look.printers, v.printer);
    if (!accessoryId) errors.push({ column: "accessory", code: "unresolved" });
    if (!printerId) errors.push({ column: "printer", code: "unresolved" });
    const start = noon(v.installedAt);
    const end = noon(v.removedAt);
    if (!start) return errors;
    if (end && end < start) errors.push({ column: "removedAt", code: "before_install" });
    else if (accessoryId && printerId) {
      // The install this row is (same accessory, printer and day) isn't its own overlap.
      const same = db
        .select({ id: installs.id, installedAt: installs.installedAt })
        .from(installs)
        .where(and(eq(installs.accessoryId, accessoryId), eq(installs.printerId, printerId)))
        .all()
        .find((i) => day(i.installedAt) === day(start));
      if (findOverlap(db, accessoryId, start, end, same?.id))
        errors.push({ column: "installedAt", code: "overlap" });
    }
    return errors;
  },

  // ponytail: two rows of one file that overlap each other pass the review and fail the apply
  // (all or nothing); check them against each other in `check` if that turns out to hurt.
  create(db: Db, v: ImportValues) {
    const look = lookups(db);
    const accessoryId = find(look.accessories, v.accessory) ?? "";
    const start = noon(v.installedAt) ?? "";
    const end = noon(v.removedAt);
    assertPeriod(db, accessoryId, start, end);
    db.insert(installs)
      .values({
        accessoryId,
        printerId: find(look.printers, v.printer) ?? "",
        installedAt: start,
        removedAt: end,
      })
      .run();
  },

  /** Writes `patch` (only the values that change) to the install. */
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    const cur = db.select().from(installs).where(eq(installs.id, target.id)).get();
    if (!cur) return;
    const look = lookups(db);
    const set = {
      accessoryId:
        patch.accessory === undefined
          ? cur.accessoryId
          : (find(look.accessories, patch.accessory) ?? cur.accessoryId),
      printerId:
        patch.printer === undefined
          ? cur.printerId
          : (find(look.printers, patch.printer) ?? cur.printerId),
      installedAt: patch.installedAt == null ? cur.installedAt : (noon(patch.installedAt) ?? ""),
      removedAt: "removedAt" in patch ? noon(patch.removedAt) : cur.removedAt,
    };
    assertPeriod(db, set.accessoryId, set.installedAt, set.removedAt, cur.id);
    db.update(installs).set(set).where(eq(installs.id, cur.id)).run();
  },
};
