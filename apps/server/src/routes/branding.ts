import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { IMAGE_MAX_BYTES, IMAGE_TYPES, imageType } from "../lib/images.ts";
import { readPreferences } from "../lib/preferences.ts";

const KINDS = ["logo", "favicon"] as const;
const params = z.object({ kind: z.enum(KINDS) });
const brandingSchema = z.object({
  logo: z.number().nullable(),
  favicon: z.number().nullable(),
});

/** What the sign-in page may read without a session: nothing else from the preferences. */
const publicBrandingSchema = z.object({
  appName: z.string(),
  showName: z.boolean(),
  logo: z.number().nullable(),
});

/** Logo and favicon live in `<dataDir>/photos` (so backups carry them); the file itself is the state. */
export const brandingRoutes =
  (db: Db, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const dir = join(dataDir, "photos");
    const find = (kind: (typeof KINDS)[number]) =>
      Object.values(IMAGE_TYPES)
        .map((ext) => join(dir, `branding-${kind}.${ext}`))
        .find((f) => {
          try {
            return statSync(f).isFile();
          } catch {
            return false;
          }
        });
    const clear = (kind: (typeof KINDS)[number]) => {
      for (const ext of Object.values(IMAGE_TYPES))
        rmSync(join(dir, `branding-${kind}.${ext}`), { force: true });
    };

    app.addContentTypeParser(
      Object.keys(IMAGE_TYPES),
      { parseAs: "buffer", bodyLimit: IMAGE_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );

    // Modified time per image (cache-buster), null when unset.
    const versions = () => {
      const v = (k: (typeof KINDS)[number]) => {
        const f = find(k);
        return f ? Math.floor(statSync(f).mtimeMs) : null;
      };
      return { logo: v("logo"), favicon: v("favicon") };
    };

    app.get("/", { schema: { response: { 200: brandingSchema } } }, async () => versions());

    // Public (lib/auth.ts): the sign-in page and the logo image load before anyone is signed in.
    app.get("/public", { schema: { response: { 200: publicBrandingSchema } } }, async () => {
      const { appName, brandShowName } = readPreferences(db);
      return { appName, showName: brandShowName, logo: versions().logo };
    });

    app.put("/:kind", { schema: { params, response: { 200: brandingSchema } } }, async (req) => {
      const ext = IMAGE_TYPES[req.headers["content-type"] as keyof typeof IMAGE_TYPES];
      if (!ext || !Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(415, "unsupported_media_type", "Send a PNG, JPEG or WebP image");
      mkdirSync(dir, { recursive: true });
      clear(req.params.kind);
      writeFileSync(join(dir, `branding-${req.params.kind}.${ext}`), req.body);
      return versions();
    });

    app.get("/:kind", { schema: { params } }, async (req, reply) => {
      const f = find(req.params.kind);
      if (!f) throw new HttpError(404, "not_found", "No image set");
      return reply.type(imageType(f) ?? "application/octet-stream").send(readFileSync(f));
    });

    app.delete(
      "/:kind",
      { schema: { params, response: { 204: z.null() } } },
      async (req, reply) => {
        clear(req.params.kind);
        return reply.status(204).send(null);
      },
    );
  };
