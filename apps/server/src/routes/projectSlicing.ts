import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  apiErrorSchema,
  type PlateState,
  projectMetaSchema,
  projectSlicingInputSchema,
  projectSlicingSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";

const { filamentProfiles, printProfiles, projectSlicePlates, projects } = schema;
const params = z.object({ id: z.uuid() });

type Fingerprint = { fileSize: number; fileMtimeMs: number; fileSha256: string };

/** Size, mtime and sha256 of a file; null when it can't be read. */
async function fingerprint(abs: string): Promise<Fingerprint | null> {
  try {
    const s = await stat(abs);
    const hash = createHash("sha256");
    await pipeline(createReadStream(abs), hash);
    return { fileSize: s.size, fileMtimeMs: s.mtimeMs, fileSha256: hash.digest("hex") };
  } catch {
    return null;
  }
}

/** Unchanged when size and mtime match; else only when the bytes still hash the same. */
async function stateOf(abs: string, saved: Fingerprint): Promise<PlateState> {
  const s = await stat(abs).catch(() => null);
  if (!s) return "missing";
  if (s.size === saved.fileSize && s.mtimeMs === saved.fileMtimeMs) return "ok";
  // ponytail: re-hashes on every read once the mtime moved; store the new mtime if that gets slow.
  const now = await fingerprint(abs);
  return !now ? "missing" : now.fileSha256 === saved.fileSha256 ? "ok" : "outdated";
}

/** GET / PUT the plates a project prints (see `projectSlicingSchema`). */
export const projectSlicingRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const project = (id: string) => {
      const row = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Project not found");
      return { folderPath: row.folderPath, meta: projectMetaSchema.parse(row.meta) };
    };

    app.get(
      "/:id/slicing",
      { schema: { params, response: { 200: projectSlicingSchema, 404: apiErrorSchema } } },
      async (req) => {
        const { folderPath, meta } = project(req.params.id);
        const rows = db
          .select()
          .from(projectSlicePlates)
          .where(eq(projectSlicePlates.projectId, req.params.id))
          .orderBy(projectSlicePlates.file, projectSlicePlates.plate)
          .all();
        // One stat (and at most one hash) per file, however many plates it has.
        const states = new Map<string, Promise<PlateState>>();
        const fileState = (r: (typeof rows)[number]) => {
          if (!folderPath || !meta.models.some((m) => m.file === r.file))
            return Promise.resolve<PlateState>("missing");
          if (!states.has(r.file)) states.set(r.file, stateOf(join(folderPath, r.file), r));
          return states.get(r.file) as Promise<PlateState>;
        };
        return {
          plates: await Promise.all(
            rows.map(async (r) => {
              const inFile = meta.models
                .find((m) => m.file === r.file)
                ?.plates.some((p) => p.index === r.plate);
              return {
                file: r.file,
                plate: r.plate,
                printProfileId: r.printProfileId,
                filaments: r.filaments,
                state: inFile ? await fileState(r) : ("missing" as const),
              };
            }),
          ),
        };
      },
    );

    app.put(
      "/:id/slicing",
      {
        schema: {
          params,
          body: projectSlicingInputSchema,
          response: { 200: projectSlicingSchema, 400: apiErrorSchema, 404: apiErrorSchema },
        },
      },
      async (req) => {
        const { folderPath, meta } = project(req.params.id);
        const { plates } = req.body;
        // Only plates of 3MFs the scanner listed; nothing the client invents is read.
        for (const p of plates)
          if (!meta.models.find((m) => m.file === p.file)?.plates.some((x) => x.index === p.plate))
            throw new HttpError(400, "invalid_reference", `Unknown plate ${p.plate} of ${p.file}`);
        const known = (table: typeof printProfiles | typeof filamentProfiles, ids: string[]) =>
          new Set(
            ids.length
              ? db
                  .select({ id: table.id })
                  .from(table)
                  .where(inArray(table.id, [...new Set(ids)]))
                  .all()
                  .map((r) => r.id)
              : [],
          );
        const printIds = plates.flatMap((p) => (p.printProfileId ? [p.printProfileId] : []));
        const filamentIds = plates.flatMap((p) => p.filaments.filter((f): f is string => !!f));
        const prints = known(printProfiles, printIds);
        const filaments = known(filamentProfiles, filamentIds);
        if (printIds.some((i) => !prints.has(i)) || filamentIds.some((i) => !filaments.has(i)))
          throw new HttpError(400, "invalid_reference", "Unknown profile");

        const fingerprints = new Map<string, Fingerprint>();
        for (const f of new Set(plates.map((p) => p.file))) {
          const fp = folderPath && (await fingerprint(join(folderPath, f)));
          if (!fp) throw new HttpError(400, "invalid_reference", `Cannot read ${f}`);
          fingerprints.set(f, fp);
        }
        db.transaction((tx) => {
          tx.delete(projectSlicePlates)
            .where(eq(projectSlicePlates.projectId, req.params.id))
            .run();
          if (plates.length)
            tx.insert(projectSlicePlates)
              .values(
                plates.map((p) => ({
                  ...p,
                  ...(fingerprints.get(p.file) as Fingerprint),
                  projectId: req.params.id,
                })),
              )
              .run();
        });
        return { plates: plates.map((p) => ({ ...p, state: "ok" as const })) };
      },
    );
  };
