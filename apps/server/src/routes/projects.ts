import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  apiErrorSchema,
  type Page,
  type Project,
  pageOf,
  projectInputSchema,
  projectListQuery,
  projectMetaSchema,
  projectPatchSchema,
  projectScanStatusSchema,
  projectSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { listPage } from "../lib/list.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const { projects } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Rows older than the scanner (e.g. demo data) hold other meta; parsing fills the defaults in.
const out = (row: unknown) => {
  const r = row as Project;
  return { ...r, meta: projectMetaSchema.parse(r.meta) };
};

export const projectsRoutes =
  (db: Db, dataDir: string, scanner: ProjectScanner): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Project not found");
      return out(row);
    };

    // Scan: POST starts a background scan (or queues another pass), GET reports progress.
    app.get("/scan", { schema: { response: { 200: projectScanStatusSchema } } }, async () =>
      scanner.status(),
    );
    app.post(
      "/scan",
      { schema: { response: { 202: projectScanStatusSchema } } },
      async (_, reply) => reply.status(202).send(scanner.start()),
    );

    app.get(
      "/",
      { schema: { querystring: projectListQuery, response: { 200: pageOf(projectSchema) } } },
      async (req) => {
        const page = listPage(db, projects, req.query, {
          sort: { name: projects.name, createdAt: projects.createdAt },
          dateColumn: projects.createdAt,
          where: [isNull(projects.archivedAt)],
        });
        return { ...page, items: page.items.map(out) } as Page<Project>;
      },
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: projectSchema, ...notFound } } },
      async (req) => get(req.params.id),
    );

    app.post(
      "/",
      {
        schema: {
          body: projectInputSchema,
          response: { 201: projectSchema, 400: apiErrorSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const { folderPath, ...fields } = req.body;
        // Only what the user typed is "edited"; `undefined` means "let the scan decide".
        const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const row = folderPath
          ? await scanner.addFolder(folderPath, given)
          : db
              .insert(projects)
              .values({
                ...given,
                name: fields.name,
                editedFields: Object.keys(given) as Project["editedFields"],
              })
              .returning()
              .get();
        return reply.status(201).send(out(row));
      },
    );

    app.patch(
      "/:id",
      {
        schema: { params, body: projectPatchSchema, response: { 200: projectSchema, ...notFound } },
      },
      async (req) => {
        const { editedFields } = get(req.params.id);
        const touched = Object.keys(req.body) as Project["editedFields"];
        const row = db
          .update(projects)
          .set({ ...req.body, editedFields: [...new Set([...editedFields, ...touched])] })
          .where(eq(projects.id, req.params.id))
          .returning()
          .get();
        return out(row);
      },
    );

    app.get("/:id/thumbnail", { schema: { params } }, async (req, reply) => {
      const { thumbnailPath } = get(req.params.id);
      if (!thumbnailPath) throw new HttpError(404, "not_found", "Project has no thumbnail");
      return reply
        .type(IMAGE_TYPES[extname(thumbnailPath)] ?? "application/octet-stream")
        .send(await readFile(join(dataDir, thumbnailPath)));
    });
  };
