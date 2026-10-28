import { stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  apiErrorSchema,
  fsListResponseSchema,
  ROOT_DEFAULTS,
  ROOT_HUB,
  type Root,
  rootInputSchema,
  rootPatchSchema,
  rootSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, max } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { listRoots, onDevice, type Root as Row } from "../projects/rootFs.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const { devices, projects, roots } = schema;
const params = z.object({ id: z.uuid() });
const errors = {
  400: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  504: apiErrorSchema,
};

/** Whether two folders on one device are the same or one holds the other. */
function overlap(a: string, b: string, sep: string) {
  const fold = (p: string) => (sep === "\\" ? p.toLowerCase() : p).replace(/[\\/]+$/, "") + sep;
  const [x, y] = [fold(a), fold(b)];
  return x.startsWith(y) || y.startsWith(x);
}

/** The project roots (ADR-0014). Everyone reads them (pickers); only admins change them. */
export const rootsRoutes =
  (db: Db, channel: HubChannel, scanner: ProjectScanner): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(roots).where(eq(roots.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Root not found");
      return row;
    };
    const out = (r: Row): Root => {
      if (!onDevice(r)) return { ...r, state: "ok", deviceName: null };
      const device = db
        .select({ name: devices.name })
        .from(devices)
        .where(eq(devices.id, r.location))
        .get();
      const state = !channel.online(r.location)
        ? "offline"
        : scanner.missingOnDevice(r.id)
          ? "missing"
          : "ok";
      return { ...r, state, deviceName: device?.name ?? null };
    };
    /** Tells a root's device to read its roots again (an offline one does when it connects). */
    const changed = (r: Row) => {
      if (onDevice(r) && channel.online(r.location))
        channel.publish(r.location, { type: "roots.changed" });
    };

    app.get("/", { schema: { response: { 200: z.array(rootSchema) } } }, async () =>
      listRoots(db).map(out),
    );

    app.post(
      "/",
      { schema: { body: rootInputSchema, response: { 201: rootSchema, ...errors } } },
      async (req, reply) => {
        const { path, name, location, ...settings } = req.body;
        if (
          db
            .select()
            .from(roots)
            .where(and(eq(roots.location, location), eq(roots.path, path)))
            .get()
        )
          throw new HttpError(409, "root_exists", "This folder is a project root already");
        if (location === ROOT_HUB) {
          const dir = isAbsolute(path) && (await stat(path).catch(() => null))?.isDirectory();
          if (!dir) throw new HttpError(400, "invalid_folder", "Folder not found");
        } else {
          if (!db.select().from(devices).where(eq(devices.id, location)).get())
            throw new HttpError(404, "not_found", "Device not found");
          // The device checks the folder: it must be there, and absolute on the device's OS.
          const list = await channel
            .ask(
              location,
              (requestId) => ({ type: "fs.list", requestId, path }),
              fsListResponseSchema,
            )
            .catch((e) =>
              Promise.reject(
                e instanceof HttpError && e.statusCode < 500 && e.code !== "device_offline"
                  ? new HttpError(400, "invalid_folder", "Folder not found")
                  : e,
              ),
            );
          const others = db.select().from(roots).where(eq(roots.location, location)).all();
          if (others.some((o) => overlap(o.path, path, list.sep)))
            throw new HttpError(
              409,
              "root_nested",
              "This folder is inside another root, or holds one",
            );
        }
        const last = db
          .select({ n: max(roots.position) })
          .from(roots)
          .get()?.n;
        // A device's path is in its own OS's form.
        const shortName =
          location === ROOT_HUB ? basename(path) : path.split(/[\\/]/).filter(Boolean).at(-1);
        const row = db
          .insert(roots)
          .values({
            ...ROOT_DEFAULTS,
            ...settings,
            name: name ?? (shortName || path),
            location,
            path,
            position: (last ?? -1) + 1,
          })
          .returning()
          .get();
        changed(row);
        return reply.status(201).send(out(row));
      },
    );

    app.patch(
      "/:id",
      { schema: { params, body: rootPatchSchema, response: { 200: rootSchema, ...errors } } },
      async (req) => {
        const row = get(req.params.id);
        if (!Object.keys(req.body).length) return out(row);
        const next = db
          .update(roots)
          .set(req.body)
          .where(eq(roots.id, req.params.id))
          .returning()
          .get();
        changed(next);
        return out(next);
      },
    );

    // Projects point at their root: one still in use stays (its projects would lose their folder).
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const row = get(req.params.id);
        if (db.select({ id: projects.id }).from(projects).where(eq(projects.rootId, row.id)).get())
          throw new HttpError(409, "root_in_use", "Projects still use this folder");
        db.delete(roots).where(eq(roots.id, row.id)).run();
        changed(row);
        return reply.status(204).send(null);
      },
    );
  };
