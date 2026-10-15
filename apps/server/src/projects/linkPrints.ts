import { bestMatches, type ProjectMeta, printKey } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull } from "drizzle-orm";

const { prints, projects } = schema;

/**
 * The project a print's title names, or null when none or several do. A MakerWorld print is titled
 * after its model, which the model's 3MF keeps as `designTitle`; any other print after its file
 * (see `bestMatches`), or after the folder the file is in (`spice-rack-parametric_Plate 1` for
 * `spice-rack-parametric/printables/spice_rack.3mf`). Only active projects are named.
 */
export function projectMatcher(db: Db): (title: string) => string | null {
  const designs = new Map<string, Set<string>>();
  const names: { projectId: string; name: string }[] = [];
  for (const p of db
    .select({ id: projects.id, meta: projects.meta })
    .from(projects)
    .where(isNull(projects.archivedAt))
    .all()) {
    const meta = p.meta as Partial<ProjectMeta>;
    for (const m of meta.models ?? [])
      if (m.designTitle) {
        const k = printKey(m.designTitle);
        designs.set(k, (designs.get(k) ?? new Set()).add(p.id));
      }
    const seen = new Set<string>();
    for (const f of meta.files ?? []) {
      if (!/\.3mf$/i.test(f.path)) continue;
      for (const name of f.path.split("/"))
        if (!seen.has(name)) {
          seen.add(name);
          names.push({ projectId: p.id, name });
        }
    }
  }
  const only = (ids: Iterable<string>) => {
    const set = new Set(ids);
    const [id] = set;
    return set.size === 1 && id ? id : null;
  };
  return (title) => {
    const design = designs.get(printKey(title));
    if (design) return only(design);
    return only(bestMatches(title, names, (n) => n.name).map((n) => n.projectId));
  };
}

/**
 * Gives imported prints that have no project the one `projectMatcher` finds. Returns how many
 * prints were linked.
 * ponytail: a print unlinked by hand is linked again while its title still matches; add a
 * "no project" marker if that becomes a problem.
 */
export function linkPrints(db: Db): number {
  const match = projectMatcher(db);
  const unlinked = db
    .select({ id: prints.id, title: prints.title })
    .from(prints)
    .where(and(eq(prints.origin, "integration"), isNull(prints.projectId)))
    .all();
  let linked = 0;
  for (const p of unlinked) {
    const projectId = match(p.title);
    if (!projectId) continue;
    db.update(prints).set({ projectId }).where(eq(prints.id, p.id)).run();
    linked++;
  }
  return linked;
}
