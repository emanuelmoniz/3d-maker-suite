import { bestMatches, type ProjectMeta } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull } from "drizzle-orm";

const { prints, projects } = schema;

/**
 * Gives imported prints that have no project the one whose 3MF their title names (see
 * `bestMatches`). A title that fits files of several projects is left alone. Returns how many
 * prints were linked.
 * ponytail: a print unlinked by hand is linked again while its title still matches; add a
 * "no project" marker if that becomes a problem.
 */
export function linkPrints(db: Db): number {
  const files = db
    .select({ id: projects.id, meta: projects.meta })
    .from(projects)
    .where(isNull(projects.archivedAt))
    .all()
    .flatMap((p) =>
      ((p.meta as Partial<ProjectMeta>).files ?? [])
        .filter((f) => /\.3mf$/i.test(f.path))
        .map((f) => ({ projectId: p.id, name: f.path.split("/").pop() ?? "" })),
    );
  if (!files.length) return 0;
  const unlinked = db
    .select({ id: prints.id, title: prints.title })
    .from(prints)
    .where(and(eq(prints.origin, "integration"), isNull(prints.projectId)))
    .all();
  let linked = 0;
  for (const p of unlinked) {
    const ids = new Set(bestMatches(p.title, files, (f) => f.name).map((f) => f.projectId));
    const [only] = ids;
    if (ids.size !== 1 || !only) continue;
    db.update(prints).set({ projectId: only }).where(eq(prints.id, p.id)).run();
    linked++;
  }
  return linked;
}
