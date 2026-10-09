import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiErrorSchema } from "@3d-maker-suite/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";

/** Accepted upload image types (content-type → file extension) and the size cap. */
export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const imageType = (path: string) =>
  Object.entries(IMAGE_TYPES).find(([, ext]) => path.endsWith(`.${ext}`))?.[0];

/**
 * PUT/GET/DELETE `/:id/<name>` for one image per row: raw image body (no multipart dependency),
 * stored as `<dataDir>/<dir>/<id>.<ext>`. Registers the image body parser, so once per plugin.
 */
export function imageRoutes(
  app: Parameters<FastifyPluginAsyncZod>[0],
  dataDir: string,
  o: {
    name: string;
    dir: string;
    response: z.ZodType;
    /** Current image path of the row; throws 404 when the row doesn't exist. */
    get: (id: string) => string | null;
    /** Stores the new path (null = removed) and returns the row. */
    set: (id: string, path: string | null) => unknown;
  },
) {
  const params = z.object({ id: z.uuid() });
  const notFound = { 404: apiErrorSchema };
  const file = (path: string) => join(dataDir, path);

  app.addContentTypeParser(
    Object.keys(IMAGE_TYPES),
    { parseAs: "buffer", bodyLimit: IMAGE_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.put(
    `/:id/${o.name}`,
    { schema: { params, response: { 200: o.response, ...notFound } } },
    async (req) => {
      const old = o.get(req.params.id);
      const ext = IMAGE_TYPES[req.headers["content-type"] as keyof typeof IMAGE_TYPES];
      if (!ext || !Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(415, "unsupported_media_type", "Send a PNG, JPEG or WebP image");
      const path = `${o.dir}/${req.params.id}.${ext}`;
      mkdirSync(join(dataDir, o.dir), { recursive: true });
      if (old && old !== path) rmSync(file(old), { force: true });
      writeFileSync(file(path), req.body);
      return o.set(req.params.id, path);
    },
  );

  app.get(`/:id/${o.name}`, { schema: { params } }, async (req, reply) => {
    const path = o.get(req.params.id);
    if (!path) throw new HttpError(404, "not_found", "No image");
    return reply.type(imageType(path) ?? "application/octet-stream").send(readFileSync(file(path)));
  });

  app.delete(
    `/:id/${o.name}`,
    { schema: { params, response: { 204: z.null(), ...notFound } } },
    async (req, reply) => {
      const path = o.get(req.params.id);
      if (path) rmSync(file(path), { force: true });
      o.set(req.params.id, null);
      return reply.status(204).send(null);
    },
  );
}
