import { bestMatches, type ProjectMeta, printKey } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull } from "drizzle-orm";

const { prints, projects } = schema;

/** A project as the matcher sees it. */
export type MatchProject = { id: string; meta: Partial<ProjectMeta> };

/**
 * The project a print's title names, or null when none or several do. A MakerWorld print is titled
 * after its model, which the model's 3MF keeps as `designTitle`; any other print after its file
 * (see `bestMatches`), or after the folder the file is in (`spice-rack-parametric_Plate 1` for
 * `spice-rack-parametric/printables/spice_rack.3mf`). Only active projects are named. `extra`
 * adds projects that aren't stored yet, or replaces a stored one's meta (an import's rows).
 */
export function projectMatcher(
  db: Db,
  extra: MatchProject[] = [],
): (title: string) => string | null {
  const designs = new Map<string, Set<string>>();
  const names: { projectId: string; name: string }[] = [];
  const replaced = new Set(extra.map((p) => p.id));
  const stored = db
    .select({ id: projects.id, meta: projects.meta })
    .from(projects)
    .where(isNull(projects.archivedAt))
    .all()
    .filter((p) => !replaced.has(p.id)) as MatchProject[];
  for (const p of [...stored, ...extra]) {
    for (const m of p.meta.models ?? [])
      if (m.designTitle) {
        const k = printKey(m.designTitle);
        designs.set(k, (designs.get(k) ?? new Set()).add(p.id));
      }
    const seen = new Set<string>();
    for (const f of p.meta.files ?? []) {
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

/** Imported prints without a project, unless that is on purpose: the ones linking looks at. */
const unlinked = (db: Db) =>
  db
    .select({ id: prints.id, title: prints.title })
    .from(prints)
    .where(
      and(eq(prints.origin, "integration"), isNull(prints.projectId), eq(prints.noProject, false)),
    )
    .all();

/**
 * Gives imported prints that have no project the one `projectMatcher` finds. Returns how many
 * prints were linked. Projects in `fixed` had their prints picked by hand: they get none here.
 */
export function linkPrints(db: Db, fixed: ReadonlySet<string> = new Set()): number {
  const match = projectMatcher(db);
  let linked = 0;
  for (const p of unlinked(db)) {
    const projectId = match(p.title);
    if (!projectId || fixed.has(projectId)) continue;
    db.update(prints).set({ projectId }).where(eq(prints.id, p.id)).run();
    linked++;
  }
  return linked;
}

/**
 * Per project in `rows`: the prints it has now plus the ones `linkPrints` would give it once
 * `rows` are stored as they are given (all of them at once, so two rows naming one print get none).
 */
export function suggestPrints(db: Db, rows: MatchProject[]): Map<string, string[]> {
  const match = projectMatcher(db, rows);
  const out = new Map(rows.map((r) => [r.id, [] as string[]]));
  for (const p of db.select({ id: prints.id, projectId: prints.projectId }).from(prints).all())
    if (p.projectId) out.get(p.projectId)?.push(p.id);
  for (const p of unlinked(db)) {
    const id = match(p.title);
    if (id) out.get(id)?.push(p.id);
  }
  return out;
}
