import { stat } from "node:fs/promises";
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
import { fingerprint, sameAsScanned } from "./fingerprint.ts";
import { onDeviceRoot, projectFile } from "./rootFs.ts";
import {
  projectSliceJob,
  type SliceQueue,
  slicedWithOther,
  sliceIntegration,
  slicerResolver,
} from "./sliceQueue.ts";

const { projectSlicePlates, projects, roots } = schema;
type Row = typeof projectSlicePlates.$inferSelect;
type Project = typeof projects.$inferSelect;

/** The project's own choice, else its root's. */
function autoSliceOn(db: Db, project: Project) {
  if (project.autoSlice != null) return project.autoSlice;
  const root = project.rootId
    ? db.select().from(roots).where(eq(roots.id, project.rootId)).get()
    : undefined;
  return root?.autoSlice ?? true;
}

/** An auto slicing alert of the project, keyed so each event alerts once. */
const alertOf =
  (db: Db, project: Project) =>
  (kind: AlertKind, severity: AlertSeverity, key: string, ctx: Record<string, string | number>) =>
    raise(db, {
      kind,
      severity,
      module: "projects",
      task: `project:${project.id}`,
      entityType: "project",
      entityId: `${project.id}:${key}`,
      context: { projectId: project.id, name: project.name, ...ctx },
    });

const failedAlert =
  (alert: ReturnType<typeof alertOf>, file: string, plate: number, key: string) =>
  (error: string) =>
    alert("slice_failed", "error", `${file}:${plate}:${key}`, {
      file,
      plate,
      code: error.split(":")[0] ?? error,
    });

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
  if (!project?.rootId || !sliceIntegration(db, adapters)) return;
  if (!autoSliceOn(db, project)) return;
  const after = projectMetaSchema.parse(project.meta);
  const rows = db
    .select()
    .from(projectSlicePlates)
    .where(eq(projectSlicePlates.projectId, projectId))
    .all();
  const alert = alertOf(db, project);
  const device = onDeviceRoot(db, project.rootId);

  for (const file of new Set(rows.map((r) => r.file))) {
    const mine = rows.filter((r) => r.file === file);
    const was = before.models.find((m) => m.file === file);
    const model = after.models.find((m) => m.file === file);
    let sha = "gone";
    let stale = mine;
    if (model) {
      // A device's file is pulled only when its scan says it changed.
      const seen = after.files.find((f) => f.path === file);
      if (device && mine.every((r) => sameAsScanned(seen, r))) continue;
      // Same size and mtime as a row's last slice (or save): that row is current, no hash needed.
      const abs = await projectFile(db, project, file);
      const s = abs ? await stat(abs).catch(() => null) : null;
      stale = mine.filter((r) => r.fileSize !== s?.size || r.fileMtimeMs !== s?.mtimeMs);
      const now = abs && stale.length ? await fingerprint(abs) : null;
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
          projectSliceJob(
            db,
            adapters,
            log,
            { projectId, file, plate: r.plate },
            failedAlert(alert, file, r.plate, sha),
          ),
        ),
    );
  }
}

/**
 * After a slicer integration's version changed (an install or update): re-slices the plates it
 * slices whose last slice was made with it at another version, in projects with auto slicing on.
 * A failed slice alerts once per version.
 */
export async function autoSliceSlicer(
  db: Db,
  adapters: IntegrationAdapter[],
  queue: SliceQueue,
  log: FastifyBaseLogger,
  integrationId: string,
) {
  const resolve = slicerResolver(db, adapters);
  const fallback = resolve()?.row.id;
  for (const project of db.select().from(projects).all()) {
    if (!project.rootId || !autoSliceOn(db, project)) continue;
    const alert = alertOf(db, project);
    const rows = db
      .select()
      .from(projectSlicePlates)
      .where(eq(projectSlicePlates.projectId, project.id))
      .all();
    queue.add(
      rows.flatMap((r) => {
        const now = resolve([r.slicerIntegrationId, project.slicerIntegrationId])?.row;
        if (
          !r.slicedAt ||
          now?.id !== integrationId ||
          (r.slicedIntegrationId ?? fallback) !== integrationId ||
          !slicedWithOther(r, now, fallback)
        )
          return [];
        const job = { projectId: project.id, file: r.file, plate: r.plate };
        const key = `v${now.slicerVersion}`;
        return [projectSliceJob(db, adapters, log, job, failedAlert(alert, r.file, r.plate, key))];
      }),
    );
  }
}
