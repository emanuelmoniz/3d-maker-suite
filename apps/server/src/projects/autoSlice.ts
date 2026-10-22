import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type AlertKind,
  type AlertSeverity,
  type IntegrationAdapter,
  type ProjectMeta,
  type ProjectModel,
  projectMetaSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { raise } from "../alerts/evaluate.ts";
import { insideRoots } from "../lib/launcher.ts";
import { readPreferences } from "../lib/preferences.ts";
import { fingerprint } from "./fingerprint.ts";
import { projectSliceJob, type SliceQueue, sliceIntegration } from "./sliceQueue.ts";

const { projectSlicePlates, projects } = schema;
type Row = typeof projectSlicePlates.$inferSelect;

/**
 * Which saved plates of a changed 3MF still slice with their saved setup, and whether the setup
 * itself changed. A saved plate is valid while it exists and uses no slot past the ones its setup
 * maps (`filaments` has one entry per slot). A removed plate renumbers the rest, so then none is.
 */
export function classify(
  before: ProjectModel | undefined,
  after: ProjectModel | undefined,
  rows: Pick<Row, "plate" | "filaments">[],
) {
  const was = new Set(before?.plates.map((p) => p.index));
  const now = new Map(after?.plates.map((p) => [p.index, p]));
  if (!after || [...was].some((i) => !now.has(i)) || rows.some((r) => !now.has(r.plate)))
    return { slice: [] as number[], changed: true };
  const slots = (i: number) => Math.max(0, ...(now.get(i)?.filaments.map((f) => f.slot) ?? []));
  const slice = rows.filter((r) => slots(r.plate) <= r.filaments.length).map((r) => r.plate);
  return { slice, changed: slice.length < rows.length || [...now.keys()].some((i) => !was.has(i)) };
}

/**
 * After a scan (full, at startup, or of one folder): re-slices the outdated plates of each changed 3MF with their saved
 * setup, when the project (else its root) has auto slicing on. A changed setup or a failed slice
 * raises an alert keyed by the file's new bytes, so each change alerts once.
 */
export async function autoSlice(
  db: Db,
  adapters: IntegrationAdapter[],
  queue: SliceQueue,
  log: FastifyBaseLogger,
  projectId: string,
  before: ProjectMeta,
) {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  const folder = project?.folderPath;
  if (!project || !folder || !sliceIntegration(db, adapters)) return;
  const off = readPreferences(db).projectRoots.filter((r) => !r.autoSlice);
  const on =
    project.autoSlice ??
    !(await insideRoots(
      folder,
      off.map((r) => r.path),
    ));
  if (!on) return;
  const after = projectMetaSchema.parse(project.meta);
  const rows = db
    .select()
    .from(projectSlicePlates)
    .where(eq(projectSlicePlates.projectId, projectId))
    .all();
  const alert = (
    kind: AlertKind,
    severity: AlertSeverity,
    key: string,
    ctx: Record<string, string | number>,
  ) =>
    raise(db, {
      kind,
      severity,
      module: "projects",
      task: `project:${projectId}`,
      entityType: "project",
      entityId: `${projectId}:${key}`,
      context: { projectId, name: project.name, ...ctx },
    });

  for (const file of new Set(rows.map((r) => r.file))) {
    const mine = rows.filter((r) => r.file === file);
    const was = before.models.find((m) => m.file === file);
    const model = after.models.find((m) => m.file === file);
    let sha = "gone";
    let stale = mine;
    if (model) {
      // Same size and mtime as a row's last slice (or save): that row is current, no hash needed.
      const s = await stat(join(folder, file)).catch(() => null);
      stale = mine.filter((r) => r.fileSize !== s?.size || r.fileMtimeMs !== s?.mtimeMs);
      const now = stale.length ? await fingerprint(join(folder, file)) : null;
      if (!now) continue;
      sha = now.fileSha256;
      stale = stale.filter((r) => r.fileSha256 !== sha);
      if (!stale.length) continue;
    } else if (!was) continue; // gone before this scan: already "missing", no news
    const { slice, changed } = classify(was, model, mine);
    if (changed) alert("slice_setup_changed", "warning", `${file}:${sha}`, { file });
    queue.add(
      stale
        .filter((r) => r.slicedAt && slice.includes(r.plate))
        .map((r) =>
          projectSliceJob(db, adapters, log, { projectId, file, plate: r.plate }, (error) =>
            alert("slice_failed", "error", `${file}:${r.plate}:${sha}`, {
              file,
              plate: r.plate,
              code: error.split(":")[0] ?? error,
            }),
          ),
        ),
    );
  }
}
