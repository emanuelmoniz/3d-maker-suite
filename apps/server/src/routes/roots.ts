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
import { and, eq, inArray, max, ne } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { mayEditRoot, rootRule } from "../lib/auth.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { listRoots, onDevice, type Root as Row } from "../projects/rootFs.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const { devices, projects, rootEditors, roots, users } = schema;
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
    const out = (r: Row, user: FastifyRequest["user"]): Root => {
      const rule = rootRule(db, r);
      const access = { editorIds: rule.editorIds, canEdit: mayEditRoot(user, rule) };
      if (!onDevice(r)) return { ...r, ...access, state: "ok", deviceName: null };
      const device = db
        .select({ name: devices.name })
        .from(devices)
        .where(eq(devices.id, r.location))
        .get();
      const state = !channel.online(r.location)
        ? "offline"
        : scanner.unsharedOnDevice(r.id)
          ? "unshared"
          : scanner.missingOnDevice(r.id)
            ? "missing"
            : "ok";
      return { ...r, ...access, state, deviceName: device?.name ?? null };
    };
    /** Replaces a root's picked editors: editors and admins only (a viewer can't edit anything). */
    const setEditors = (rootId: string, ids: string[] | undefined) => {
      if (!ids) return;
      const unique = [...new Set(ids)];
      const found = unique.length
        ? db
            .select({ id: users.id })
            .from(users)
            .where(and(inArray(users.id, unique), ne(users.role, "viewer")))
            .all()
        : [];
      if (found.length !== unique.length)
        throw new HttpError(400, "invalid_reference", "Pick editors or admins");
      db.transaction((tx) => {
        tx.delete(rootEditors).where(eq(rootEditors.rootId, rootId)).run();
        if (unique.length)
          tx.insert(rootEditors)
            .values(unique.map((userId) => ({ rootId, userId })))
            .run();
      });
    };
    /** Tells a root's device to read its roots again (an offline one does when it connects). */
    const changed = (r: Row) => {
      if (onDevice(r) && channel.online(r.location))
        channel.publish(r.location, { type: "roots.changed" });
    };

    app.get("/", { schema: { response: { 200: z.array(rootSchema) } } }, async (req) =>
      listRoots(db).map((r) => out(r, req.user)),
    );

    app.post(
      "/",
      { schema: { body: rootInputSchema, response: { 201: rootSchema, ...errors } } },
      async (req, reply) => {
        const { path, name, location, editorIds, ...settings } = req.body;
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
          // The device checks the folder: it must be there, absolute on the device's OS and in one
          // of its shared folders (403 path_denied).
          const list = await channel
            .ask(
              location,
              (requestId) => ({ type: "fs.list", requestId, path }),
              fsListResponseSchema,
            )
            .catch((e) =>
              Promise.reject(
                e instanceof HttpError &&
                  e.statusCode < 500 &&
                  e.code !== "device_offline" &&
                  e.code !== "path_denied"
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
        const { editorIds: _, ...defaults } = ROOT_DEFAULTS;
        const row = db
          .insert(roots)
          .values({
            ...defaults,
            ...settings,
            name: name ?? (shortName || path),
            location,
            path,
            position: (last ?? -1) + 1,
          })
          .returning()
          .get();
        setEditors(row.id, editorIds);
        changed(row);
        return reply.status(201).send(out(row, req.user));
      },
    );

    app.patch(
      "/:id",
      { schema: { params, body: rootPatchSchema, response: { 200: rootSchema, ...errors } } },
      async (req) => {
        const row = get(req.params.id);
        const { editorIds, ...fields } = req.body;
        setEditors(row.id, editorIds);
        if (!Object.keys(fields).length) return out(row, req.user);
        const next = db
          .update(roots)
          .set(fields)
          .where(eq(roots.id, req.params.id))
          .returning()
          .get();
        changed(next);
        return out(next, req.user);
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
        await scanner.dropDevicePreviews(row.id);
        changed(row);
        return reply.status(204).send(null);
      },
    );
  };
