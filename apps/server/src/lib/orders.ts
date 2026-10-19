import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, notInArray } from "drizzle-orm";
import { HttpError } from "../errors.ts";

const { orderProjects, prints } = schema;

/** Replaces the order's projects; refuses to drop one its prints still belong to. */
export const setProjects = (
  tx: Pick<Db, "select" | "insert" | "delete">,
  id: string,
  ids: string[],
) => {
  const inUse = tx
    .select({ id: prints.id })
    .from(prints)
    .where(and(eq(prints.orderId, id), notInArray(prints.projectId, ids)))
    .get();
  if (inUse)
    throw new HttpError(
      409,
      "order_project_in_use",
      "The order has prints of a project being removed",
    );
  tx.delete(orderProjects).where(eq(orderProjects.orderId, id)).run();
  tx.insert(orderProjects)
    .values(ids.map((projectId) => ({ orderId: id, projectId })))
    .run();
};
