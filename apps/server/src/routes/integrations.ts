import {
  adapterInfoSchema,
  apiErrorSchema,
  defaultPolicy,
  deviceSlicerCheckSchema,
  type Integration,
  IntegrationError,
  integrationInputSchema,
  integrationPatchSchema,
  integrationSchema,
  isAction,
  type LoginInput,
  type LoginResult,
  listQuery,
  loginInputSchema,
  loginResultSchema,
  type Page,
  pageOf,
  type SyncRun,
  slicerCheckSchema,
  slicerInstallSchema,
  slicerInstallStatusSchema,
  slicerReleaseSchema,
  syncRequestSchema,
  syncResultSchema,
  syncRunFilters,
  syncRunSchema,
  syncRunSortFields,
  testResultSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { asc, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import {
  activeCapabilities,
  detectedDir,
  policyOf,
  presetLibrary,
  unavailable,
  workerDevice,
} from "../integrations/capabilities.ts";
import type { SlicerInstaller } from "../integrations/managedSlicer.ts";
import { readSecrets, writeSecrets } from "../integrations/secrets.ts";
import type { Syncer } from "../integrations/sync.ts";
import type { WorkerSlicers } from "../integrations/workerSlicer.ts";
import { mayTask } from "../lib/auth.ts";
import { listPage } from "../lib/list.ts";

const { integrations, syncPolicies, syncRuns } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
const LOGIN_TTL_MS = 10 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 60 * 1000;

export const integrationsRoutes =
  (
    db: Db,
    key: Buffer,
    syncer: Syncer,
    installer: SlicerInstaller,
    workers: WorkerSlicers,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    /** A worker's slicer is on its device; a server's is here. */
    const slicerOf = (id: string) => (workers.isWorker(id) ? workers : installer);
    // ponytail: a sign-in waiting for its code lives in memory; a restart means starting over.
    const pendingLogins = new Map<string, { state: string; expires: number }>();
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
    // The encrypted column never leaves the server (ADR-0005); the setup fields only go to an
    // admin (ADR-0012): the others get what the task rows and "Open in slicer" need.
    const toApi = (full: typeof integrations.$inferSelect, admin = true) => {
      const { secrets, config, slicerConfigDir, slicerPath, slicerVersion, ...row } = full;
      const adapter = syncer.adapters.find((a) => a.id === row.adapterId);
      // A local (or server) source never syncs: it's there or it isn't.
      const local =
        adapter?.kind !== "cloud" && adapter && (unavailable(full, adapter) ? "unavailable" : "ok");
      return {
        ...row,
        ...(admin && {
          config,
          slicerConfigDir,
          slicerPath,
          slicerVersion,
          hasSecrets: !!secrets,
        }),
        kind: adapter?.kind ?? "cloud",
        presetLibrary: adapter ? presetLibrary(adapter) : null,
        deviceName: adapter?.kind === "worker" ? (workerDevice(db, full)?.name ?? null) : null,
        status: syncer.running.has(row.id) ? "syncing" : local || row.status,
        capabilities: activeCapabilities(db, full, adapter),
        policies: (adapter?.capabilities ?? []).map((type) => {
          const p = policyOf(db, row.id, type);
          const { mode, frequency, lastRunAt, pending, alertSeverities, trackUsage } = p;
          const { scope, merge, newWeight, newOpenedAt, atMinute, atHour, atWeekday, atDay } = p;
          const { editorSync, editorReview } = p;
          return {
            type,
            mode,
            frequency,
            lastRunAt,
            pending,
            alertSeverities,
            trackUsage,
            scope,
            merge,
            newWeight,
            newOpenedAt,
            atMinute,
            atHour,
            atWeekday,
            atDay,
            editorSync,
            editorReview,
          };
        }),
      } as Integration;
    };
    const get = (id: string) => {
      const row = db.select().from(integrations).where(eq(integrations.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Integration not found");
      return row;
    };

    app.get("/adapters", { schema: { response: { 200: z.array(adapterInfoSchema) } } }, async () =>
      syncer.adapters.map((a) => ({
        id: a.id,
        kind: a.kind,
        config: z.toJSONSchema(a.configSchema, { io: "input" }),
        secrets: z.toJSONSchema(a.secretsSchema, { io: "input" }),
        login: !!a.login,
        capabilities: [...a.capabilities],
        detectedConfigDir: detectedDir(a.library),
        libraryId: a.library?.id ?? null,
        managed: a.managed ? { repo: a.managed.repo, licenceUrl: a.managed.licenceUrl } : null,
      })),
    );

    const isAdmin = (req: FastifyRequest) => !req.user || req.user.role === "admin";

    app.get("/", { schema: { response: { 200: z.array(integrationSchema) } } }, async (req) =>
      db
        .select()
        .from(integrations)
        .orderBy(asc(integrations.createdAt))
        .all()
        .map((row) => toApi(row, isAdmin(req))),
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: integrationSchema, ...notFound } } },
      async (req) => toApi(get(req.params.id), isAdmin(req)),
    );

    app.post(
      "/",
      { schema: { body: integrationInputSchema, response: { 201: integrationSchema } } },
      async (req, reply) => {
        const { adapterId, enabled, config, secrets } = req.body;
        const adapter = adapterOf(adapterId);
        const values = {
          adapterId,
          enabled,
          config: parse(adapter.configSchema, config, "invalid_config"),
        };
        const plain = parse(adapter.secretsSchema, secrets, "invalid_secrets");
        const id = db.transaction(() => {
          const row = db.insert(integrations).values(values).returning().get();
          writeSecrets(db, key, row.id, plain as Record<string, string>);
          // Spool weights from a vendor are estimates: not tracked until you opt in. Without a
          // row a type follows `defaultPolicy`, so integrations added before keep their setting.
          if (adapter.capabilities.includes("spools"))
            db.insert(syncPolicies)
              .values({
                integrationId: row.id,
                type: "spools",
                ...defaultPolicy("spools"),
                trackUsage: false,
              })
              .run();
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
        const { config, secrets, slicerConfigDir, slicerPath, policies, ...fields } = req.body;
        if (
          (slicerConfigDir !== undefined || slicerPath !== undefined) &&
          syncer.adapters.find((a) => a.id === cur.adapterId)?.managed
        )
          throw new HttpError(409, "slicer_managed", "The app manages this slicer's paths");
        const adapter = config || secrets || policies ? adapterOf(cur.adapterId) : undefined;
        for (const p of policies ?? [])
          if (!adapter?.capabilities.includes(p.type) || (isAction(p.type) && p.mode === "auto"))
            throw new HttpError(400, "invalid_policy", `No such policy for "${p.type}"`);
        db.transaction(() => {
          for (const { type, ...set } of policies ?? [])
            if (Object.keys(set).length)
              db.insert(syncPolicies)
                .values({ integrationId: cur.id, type, ...defaultPolicy(type), ...set })
                .onConflictDoUpdate({
                  target: [syncPolicies.integrationId, syncPolicies.type],
                  set,
                })
                .run();
          db.update(integrations)
            .set({
              // Always something to set, also when only policies or secrets change.
              updatedAt: new Date().toISOString(),
              ...fields,
              // An empty path means "none" (or "the detected folder").
              ...(slicerConfigDir !== undefined && { slicerConfigDir: slicerConfigDir || null }),
              ...(slicerPath !== undefined && { slicerPath: slicerPath || null }),
              ...(config &&
                adapter && { config: parse(adapter.configSchema, config, "invalid_config") }),
              // Another device or source: its slicer is picked again.
              ...(config &&
                adapter?.kind === "worker" &&
                JSON.stringify(config) !== JSON.stringify(cur.config) && {
                  slicerPath: null,
                  slicerVersion: null,
                }),
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
        // A server or worker integration's slicer goes with it.
        if (workers.isWorker(req.params.id)) await workers.remove(req.params.id, false);
        installer.remove(req.params.id, false);
        db.delete(integrations).where(eq(integrations.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
    );

    // Managed slicer (server and worker integrations, ADR-0013, ADR-0014). Admin-only, reads too
    // (lib/auth.ts).
    app.get(
      "/:id/slicer/releases",
      {
        schema: {
          params,
          querystring: z.object({ pre: z.stringbool().default(false) }),
          response: { 200: z.array(slicerReleaseSchema), ...notFound, 502: apiErrorSchema },
        },
      },
      async (req) => slicerOf(req.params.id).releases(req.params.id, req.query.pre),
    );

    app.get(
      "/:id/slicer/install",
      { schema: { params, response: { 200: slicerInstallStatusSchema } } },
      async (req) => slicerOf(req.params.id).status(req.params.id),
    );

    app.post(
      "/:id/slicer/install",
      {
        schema: {
          params,
          body: slicerInstallSchema,
          response: {
            202: slicerInstallStatusSchema,
            ...notFound,
            409: apiErrorSchema,
            422: apiErrorSchema,
            504: apiErrorSchema,
          },
        },
      },
      async (req, reply) =>
        reply.status(202).send(await slicerOf(req.params.id).install(req.params.id, req.body.tag)),
    );

    // A worker's installed slicer: found on its device, or a typed path, once it runs there.
    app.post(
      "/:id/slicer/check",
      {
        schema: {
          params,
          body: slicerCheckSchema,
          response: {
            200: deviceSlicerCheckSchema,
            400: apiErrorSchema,
            ...notFound,
            409: apiErrorSchema,
            422: apiErrorSchema,
            504: apiErrorSchema,
          },
        },
      },
      async (req) => workers.check(req.params.id, req.body),
    );

    app.delete(
      "/:id/slicer",
      { schema: { params, response: { 204: z.null(), ...notFound, 409: apiErrorSchema } } },
      async (req, reply) => {
        get(req.params.id);
        await slicerOf(req.params.id).remove(req.params.id);
        return reply.status(204).send(null);
      },
    );

    app.post(
      "/:id/test",
      { schema: { params, response: { 200: testResultSchema, ...notFound, 409: apiErrorSchema } } },
      async (req) => syncer.test(req.params.id),
    );

    // Interactive sign-in: email + password, then the code the vendor asks for. Only the resulting
    // secrets are stored; the password is never kept (and `*.password` is redacted from logs).
    app.post(
      "/:id/login",
      {
        schema: {
          params,
          body: loginInputSchema,
          response: { 200: loginResultSchema, ...notFound, 409: apiErrorSchema },
        },
      },
      async (req): Promise<LoginResult> => {
        const row = get(req.params.id);
        const adapter = adapterOf(row.adapterId);
        if (!adapter.login)
          throw new HttpError(400, "login_unsupported", "No sign-in for this adapter");
        let input: LoginInput;
        if ("code" in req.body) {
          const pending = pendingLogins.get(row.id);
          if (!pending || pending.expires < Date.now())
            throw new HttpError(409, "login_not_started", "Sign in with email and password first");
          input = { code: req.body.code, state: pending.state };
        } else input = req.body;
        const log = req.log.child({ integrationId: row.id, adapterId: row.adapterId });
        try {
          const step = await adapter.login(
            {
              config: adapter.configSchema.parse(row.config),
              log,
              signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
            },
            input,
          );
          if ("challenge" in step) {
            pendingLogins.set(row.id, { state: step.state, expires: Date.now() + LOGIN_TTL_MS });
            return { status: "challenge", challenge: step.challenge };
          }
          pendingLogins.delete(row.id);
          db.transaction(() => {
            writeSecrets(db, key, row.id, step.secrets);
            db.update(integrations)
              .set({ status: "new", lastError: null })
              .where(eq(integrations.id, row.id))
              .run();
          });
          // Import the printers right away; the card shows "syncing", failures land in the sync log.
          syncer.run(row.id, "manual", { type: "printers" }).catch(() => {});
          return { status: "ok" };
        } catch (e) {
          if (e instanceof IntegrationError) return { status: "error", code: e.code };
          log.warn({ err: e }, "sign-in failed");
          return { status: "error", code: "unknown" };
        }
      },
    );

    app.post(
      "/:id/sync",
      {
        schema: {
          params,
          body: syncRequestSchema,
          response: { 200: syncResultSchema, ...notFound, 409: apiErrorSchema },
        },
      },
      async (req) => {
        mayTask(db, req.user, req.params.id, req.body.type, "editorSync");
        return syncer.run(req.params.id, "manual", req.body);
      },
    );

    app.get(
      "/:id/runs",
      {
        schema: {
          params,
          querystring: listQuery(syncRunSortFields, {}, syncRunFilters),
          response: { 200: pageOf(syncRunSchema), ...notFound },
        },
      },
      async (req) => {
        get(req.params.id);
        return listPage(db, syncRuns, req.query, {
          sort: { startedAt: syncRuns.startedAt },
          defaultSort: "-startedAt",
          filters: {
            startedAt: syncRuns.startedAt,
            type: syncRuns.type,
            trigger: syncRuns.trigger,
            status: syncRuns.status,
          },
          where: [eq(syncRuns.integrationId, req.params.id)],
        }) as Page<SyncRun>;
      },
    );
  };
