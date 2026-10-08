import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { apiErrorSchema } from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  BACKUP_NAME,
  BackupError,
  type BackupInfo,
  backupsDir,
  createBackup,
  discardStaged,
  listBackups,
  stageRestore,
} from "../backup/backup.ts";
import { HttpError } from "../errors.ts";

const backupSchema = z.object({
  name: z.string(),
  size: z.number(),
  createdAt: z.string(),
  auto: z.boolean(),
});
const params = z.object({ name: z.string().regex(BACKUP_NAME) });
const notFound = { 404: apiErrorSchema };
const MAX_UPLOAD = 2 * 1024 ** 3;

export const backupsRoutes =
  (db: Db, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const file = (name: string) => {
      const f = join(backupsDir(dataDir), name);
      if (!existsSync(f)) throw new HttpError(404, "not_found", "Backup not found");
      return f;
    };
    const stage = async (f: string) => {
      try {
        await stageRestore(dataDir, f);
      } catch (e) {
        if (e instanceof BackupError) throw new HttpError(400, "invalid_backup", e.message);
        throw e;
      }
    };

    app.get("/", { schema: { response: { 200: z.array(backupSchema) } } }, async () =>
      listBackups(dataDir),
    );

    app.post("/", { schema: { response: { 201: backupSchema } } }, async (_req, reply) =>
      reply.status(201).send(await createBackup(db, dataDir)),
    );

    // Registered before /:name so "upload" isn't read as a name.
    app.addContentTypeParser(
      "application/zip",
      { parseAs: "buffer", bodyLimit: MAX_UPLOAD },
      (_req, body, done) => done(null, body),
    );
    // Backup made elsewhere (fresh install): raw zip body, validated, then kept next to the others.
    app.post(
      "/upload",
      { schema: { response: { 201: backupSchema, 400: apiErrorSchema } } },
      async (req, reply) => {
        if (!Buffer.isBuffer(req.body) || !req.body.length)
          throw new HttpError(415, "unsupported_media_type", "Send a backup .zip");
        mkdirSync(backupsDir(dataDir), { recursive: true });
        const name = `uploaded-${Date.now()}.zip`;
        const tmp = join(backupsDir(dataDir), `${name}.tmp`);
        writeFileSync(tmp, req.body);
        try {
          await stage(tmp); // only validates here; the staged copy is dropped right away
        } catch (e) {
          rmSync(tmp, { force: true });
          throw e;
        }
        discardStaged(dataDir);
        renameSync(tmp, join(backupsDir(dataDir), name));
        return reply
          .status(201)
          .send(listBackups(dataDir).find((b) => b.name === name) as BackupInfo);
      },
    );

    app.get("/:name", { schema: { params } }, async (req, reply) =>
      reply
        .header("content-disposition", `attachment; filename="${req.params.name}"`)
        .type("application/zip")
        .send(createReadStream(file(req.params.name))),
    );

    app.delete(
      "/:name",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        rmSync(file(req.params.name));
        return reply.status(204).send(null);
      },
    );

    // Restore replaces everything, so the body must say the caller confirmed. It applies on next start.
    app.post(
      "/:name/restore",
      {
        schema: {
          params,
          body: z.object({ confirm: z.literal(true) }),
          response: {
            200: z.object({ restartRequired: z.literal(true) }),
            400: apiErrorSchema,
            ...notFound,
          },
        },
      },
      async (req) => {
        await stage(file(req.params.name));
        return { restartRequired: true as const };
      },
    );
  };
