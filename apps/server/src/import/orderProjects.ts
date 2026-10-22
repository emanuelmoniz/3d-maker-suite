import { createHash } from "node:crypto";
import {
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  matchRowsOn,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { PAD, padded } from "../lib/numbers.ts";
import { find, projectRef, type Ref, refOf } from "./prints.ts";

const { orderProjects, orders, prints } = schema;

type Look = { orders: Ref; projects: Ref };
const build = (db: Db): Look => ({
  orders: refOf(
    db
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .all()
      .map((o) => ({ ...o, keys: [padded(o.number, PAD.order)] })),
  ),
  projects: projectRef(db),
});
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

/** The link has no id of its own: a uuid made from its two ids stands for it in the review. */
const linkId = (orderId: string, projectId: string) => {
  const h = createHash("sha1").update(`${orderId}:${projectId}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};

/** An order's projects, one row per link. A link is its order and its project. */
export const orderProjectImport = {
  targets(db: Db): ImportTarget[] {
    const look = lookups(db);
    return db
      .select({ number: orders.number, orderId: orders.id, projectId: orderProjects.projectId })
      .from(orderProjects)
      .innerJoin(orders, eq(orders.id, orderProjects.orderId))
      .orderBy(asc(orders.number))
      .all()
      .map((l) => {
        const project = look.projects.labels.get(l.projectId) ?? "";
        return {
          id: linkId(l.orderId, l.projectId),
          label: `${padded(l.number, PAD.order)} · ${project}`,
          values: { order: l.number, project },
        };
      });
  },
  match: matchRowsOn("order", "project"),
  canon(db: Db, v: ImportValues): ImportValues {
    const look = lookups(db);
    const id = find(look.projects, v.project);
    return { ...v, project: (id && look.projects.labels.get(id)) || (v.project ?? null) };
  },
  refs: (db: Db) => ({ projects: [...lookups(db).projects.labels.values()] }),
  missing: () => ({}),
  check(db: Db, v: ImportValues): { column: string; code: ImportErrorCode }[] {
    const look = lookups(db);
    return [
      ...(find(look.orders, v.order) ? [] : [{ column: "order", code: "unresolved" as const }]),
      ...(find(look.projects, v.project)
        ? []
        : [{ column: "project", code: "unresolved" as const }]),
    ];
  },
  create(db: Db, v: ImportValues) {
    const look = lookups(db);
    const link = {
      orderId: find(look.orders, v.order) ?? "",
      projectId: find(look.projects, v.project) ?? "",
    };
    return db.insert(orderProjects).values(link).onConflictDoNothing().run().changes > 0;
  },
  /** Moves the link; the old one goes only when no print of the order is on that project. */
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    const look = lookups(db);
    const was = {
      orderId: find(look.orders, target.values.order) ?? "",
      projectId: find(look.projects, target.values.project) ?? "",
    };
    const v = { ...target.values, ...patch };
    const now = {
      orderId: find(look.orders, v.order) ?? was.orderId,
      projectId: find(look.projects, v.project) ?? was.projectId,
    };
    if (now.orderId === was.orderId && now.projectId === was.projectId) return;
    const inUse = db
      .select({ id: prints.id })
      .from(prints)
      .where(and(eq(prints.orderId, was.orderId), eq(prints.projectId, was.projectId)))
      .get();
    if (inUse)
      throw new HttpError(
        409,
        "order_project_in_use",
        "The order has prints of a project being removed",
      );
    db.insert(orderProjects).values(now).onConflictDoNothing().run();
    db.delete(orderProjects)
      .where(
        and(eq(orderProjects.orderId, was.orderId), eq(orderProjects.projectId, was.projectId)),
      )
      .run();
  },
};
