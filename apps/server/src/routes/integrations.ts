import {
  adapterInfoSchema,
  apiErrorSchema,
  type Integration,
  integrationInputSchema,
  integrationPatchSchema,
  integrationSchema,
  type SyncRun,
  syncRunSchema,
  testResultSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { readSecrets, writeSecrets } from "../integrations/secrets.ts";
import type { Syncer } from "../integrations/sync.ts";

const { integrations, syncRuns } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };

export const integrationsRoutes =
  (db: Db, key: Buffer, syncer: Syncer): FastifyPluginAsyncZod =>
  async (app) => {
    const adapterOf = (id: string) => {
      const adapter = syncer.adapters.find((a) => a.id === id);
      if (!adapter) throw new HttpError(400, "unknown_adapter", `Unknown adapter "${id}"`);
      return adapter;
    };
    const parse = <T>(s: z.ZodType<T>, value: unknown, code: string) => {
      const r = s.safeParse(value);
      if (!r.success) throw new HttpError(400, code, z.prettifyError(r.error));
      return r.data;
    };
    // The encrypted column never leaves the server (ADR-0005).
    const toApi = ({ secrets, ...row }: typeof integrations.$inferSelect) =>
      ({
        ...row,
        hasSecrets: !!secrets,
        status: syncer.running.has(row.id) ? "syncing" : row.status,
      }) as Integration;
    const get = (id: string) => {
      const row = db.select().from(integrations).where(eq(integrations.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Integration not found");
      return row;
    };

    app.get("/adapters", { schema: { response: { 200: z.array(adapterInfoSchema) } } }, async () =>
      syncer.adapters.map((a) => ({
        id: a.id,
        config: z.toJSONSchema(a.configSchema, { io: "input" }),
        secrets: z.toJSONSchema(a.secretsSchema, { io: "input" }),
      })),
    );

    app.get("/", { schema: { response: { 200: z.array(integrationSchema) } } }, async () =>
      db.select().from(integrations).orderBy(asc(integrations.name)).all().map(toApi),
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: integrationSchema, ...notFound } } },
      async (req) => toApi(get(req.params.id)),
    );

    app.post(
      "/",
      { schema: { body: integrationInputSchema, response: { 201: integrationSchema } } },
      async (req, reply) => {
        const { adapterId, name, enabled, config, secrets } = req.body;
        const adapter = adapterOf(adapterId);
        const values = {
          adapterId,
          name,
          enabled,
          config: parse(adapter.configSchema, config, "invalid_config"),
        };
        const plain = parse(adapter.secretsSchema, secrets, "invalid_secrets");
        const id = db.transaction(() => {
          const row = db.insert(integrations).values(values).returning().get();
          writeSecrets(db, key, row.id, plain as Record<string, string>);
          return row.id;
        });
        return reply.status(201).send(toApi(get(id)));
      },
    );

    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: integrationPatchSchema,
          response: { 200: integrationSchema, ...notFound },
        },
      },
      async (req) => {
        const cur = get(req.params.id);
        const { config, secrets, ...fields } = req.body;
        const adapter = config || secrets ? adapterOf(cur.adapterId) : undefined;
        db.transaction(() => {
          db.update(integrations)
            .set({
              ...fields,
              ...(config &&
                adapter && { config: parse(adapter.configSchema, config, "invalid_config") }),
            })
            .where(eq(integrations.id, cur.id))
            .run();
          if (secrets && adapter) {
            const merged = { ...readSecrets(db, key, cur.id), ...secrets };
            parse(adapter.secretsSchema, merged, "invalid_secrets");
            writeSecrets(db, key, cur.id, merged);
          }
        });
        return toApi(get(cur.id));
      },
    );

    // Imported rows stay; their integrationId becomes null (FK `set null`). The sync log cascades.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        if (syncer.running.has(req.params.id))
          throw new HttpError(409, "sync_running", "A sync is running");
        db.delete(integrations).where(eq(integrations.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
    );

    app.post(
      "/:id/test",
      { schema: { params, response: { 200: testResultSchema, ...notFound } } },
      async (req) => syncer.test(req.params.id),
    );

    app.post(
      "/:id/sync",
      { schema: { params, response: { 200: syncRunSchema, ...notFound, 409: apiErrorSchema } } },
      async (req) => syncer.run(req.params.id, "manual"),
    );

    app.get(
      "/:id/runs",
      { schema: { params, response: { 200: z.array(syncRunSchema), ...notFound } } },
      async (req) => {
        get(req.params.id);
        return db
          .select()
          .from(syncRuns)
          .where(eq(syncRuns.integrationId, req.params.id))
          .orderBy(desc(syncRuns.startedAt))
          .limit(50)
          .all() as SyncRun[];
      },
    );
  };
