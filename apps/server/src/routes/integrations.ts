import {
  ACCOUNT_ALLOW_TYPES,
  accountConfigOf,
  accountMode,
  adapterInfoSchema,
  allowCapabilities,
  allows,
  apiErrorSchema,
  type Capability,
  defaultPolicy,
  deviceSlicerCheckSchema,
  hasLevel,
  hubSlicerPickSchema,
  type Integration,
  IntegrationError,
  integrationInputSchema,
  integrationPatchSchema,
  integrationSchema,
  isAction,
  isCatalogType,
  isPresetType,
  isUserPresetType,
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
  workerConfigSchema,
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
import { pickHubSlicer } from "../integrations/catalogSource.ts";
import type { DeviceCatalog } from "../integrations/deviceCatalog.ts";
import type { SlicerInstaller } from "../integrations/managedSlicer.ts";
import { readSecrets, writeSecrets } from "../integrations/secrets.ts";
import type { Syncer } from "../integrations/sync.ts";
import type { WorkerSlicers } from "../integrations/workerSlicer.ts";
import { mayTask } from "../lib/auth.ts";
import { listPage } from "../lib/list.ts";

const { integrations, syncPolicies, syncRuns } = schema;
const params = z.object({ id: z.uuid() });
/** The device a worker integration slices on. */
const workerDeviceId = (kind: string | undefined, config: unknown) =>
  kind === "worker" ? workerConfigSchema.safeParse(config).data?.deviceId : undefined;
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
    /** A machine picked as the hub's slicer sends its catalog (ADR-0022). */
    catalog: Pick<DeviceCatalog, "confirm" | "tell"> = {
      confirm: async () => {},
      tell: async () => {},
    },
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
      const { secrets, config, slicerConfigDir, slicerPath, slicerVersion, ...rest } = full;
      const { catalogFingerprint: _, ...row } = rest;
      const adapter = syncer.adapters.find((a) => a.id === row.adapterId);
      const profile = accountConfigOf(config);
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
        account:
          adapter?.kind === "cloud"
            ? {
                email: profile.email ?? null,
                name: profile.name ?? null,
                avatar: !!profile.avatarUrl,
                allow: Object.fromEntries(ACCOUNT_ALLOW_TYPES.map((t) => [t, allows(config, t)])),
              }
            : null,
        status: syncer.running.has(row.id) ? "syncing" : local || row.status,
        capabilities: activeCapabilities(db, syncer.adapters, full),
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

    /**
     * One install of a slicer per machine (Plan 5.5.0 Step 9): this server (installed or
     * downloaded) or a workstation. A database with both from before keeps both.
     */
    const slicerExists = (
      adapter: (typeof syncer.adapters)[number],
      deviceId: string | undefined,
      except?: string,
    ) => {
      if (adapter.kind === "cloud") return;
      const library = presetLibrary(adapter);
      const twice = db
        .select()
        .from(integrations)
        .all()
        .some((r) => {
          const a = syncer.adapters.find((x) => x.id === r.adapterId);
          if (r.id === except || !a || a.kind === "cloud" || presetLibrary(a) !== library)
            return false;
          return adapter.kind === "worker"
            ? workerDeviceId(a.kind, r.config) === deviceId
            : a.kind !== "worker";
        });
      if (twice)
        throw new HttpError(409, "slicer_exists", "This slicer is already on that machine");
    };

    const isAdmin = (req: FastifyRequest) =>
      !req.user || req.user.rights.permissions["integrations.manage"];

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
      {
        schema: {
          body: integrationInputSchema,
          response: { 201: integrationSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const { adapterId, enabled, config, secrets } = req.body;
        const adapter = adapterOf(adapterId);
        const values = {
          adapterId,
          enabled,
          config: parse(adapter.configSchema, config, "invalid_config"),
        };
        const plain = parse(adapter.secretsSchema, secrets, "invalid_secrets");
        const deviceId = workerDeviceId(adapter.kind, values.config);
        slicerExists(adapter, deviceId);
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
          // An account's user presets are read when you ask, like migration 0102's (ADR-0019).
          if (adapter.kind === "cloud")
            for (const type of adapter.capabilities.filter(isUserPresetType))
              db.insert(syncPolicies)
                .values({
                  integrationId: row.id,
                  type,
                  ...defaultPolicy(type),
                  mode: accountMode(type),
                })
                .run();
          return row.id;
        });
        if (deviceId) workers.syncWorker(deviceId);
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
        const { config, secrets, slicerConfigDir, slicerPath, policies, allow, ...fields } =
          req.body;
        // ADR-0020, ADR-0021: catalog import cards need catalog manage, preset ones presets
        // manage, everything else integrations.manage.
        const rights = req.user?.rights;
        if (rights && !rights.admin) {
          const presets = policies?.some((p) => isPresetType(p.type));
          const catalog = policies?.some((p) => isCatalogType(p.type) && !isPresetType(p.type));
          const other =
            Object.keys(req.body).some((k) => k !== "policies") ||
            policies?.some((p) => !isCatalogType(p.type));
          if (
            (presets && !hasLevel(rights.permissions, "presets", "manage")) ||
            (catalog && !hasLevel(rights.permissions, "catalog", "manage")) ||
            (other && !rights.permissions["integrations.manage"])
          )
            throw new HttpError(403, "forbidden", "Not allowed for your role");
        }
        if (
          (slicerConfigDir !== undefined || slicerPath !== undefined) &&
          syncer.adapters.find((a) => a.id === cur.adapterId)?.managed
        )
          throw new HttpError(409, "slicer_managed", "The app manages this slicer's paths");
        const adapter =
          config || secrets || policies || allow ? adapterOf(cur.adapterId) : undefined;
        if (allow && adapter?.kind !== "cloud")
          throw new HttpError(400, "invalid_allow", "Only an account has Allow switches");
        // The server's own fields (ADR-0021) survive a new config: a client never writes them.
        const kept = accountConfigOf(cur.config);
        const nextConfig =
          (config || allow) && adapter
            ? {
                ...(config
                  ? parse(adapter.configSchema, config, "invalid_config")
                  : (cur.config as object)),
                ...kept,
                ...(allow && { allow: { ...kept.allow, ...allow } }),
              }
            : undefined;
        // A worker moved to another machine: that one may have this slicer already.
        if (nextConfig && adapter?.kind === "worker") {
          const to = workerDeviceId(adapter.kind, nextConfig);
          if (to !== workerDeviceId(adapter.kind, cur.config)) slicerExists(adapter, to, cur.id);
        }
        // An Allow switch turned off stops its types, on again gives them a new account's mode.
        // The data stays either way.
        const allowed = ACCOUNT_ALLOW_TYPES.filter(
          (t) => allow?.[t] !== undefined && allow[t] !== allows(cur.config, t),
        ).flatMap((t) =>
          allowCapabilities(t)
            .filter((c) => adapter?.capabilities.some((a) => a === c))
            .map((c) => ({ type: c as Capability, on: !!allow?.[t] })),
        );
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
          for (const { type, on } of allowed) {
            const set = { mode: on ? accountMode(type) : ("off" as const) };
            db.insert(syncPolicies)
              .values({ integrationId: cur.id, type, ...defaultPolicy(type), ...set })
              .onConflictDoUpdate({ target: [syncPolicies.integrationId, syncPolicies.type], set })
              .run();
          }
          db.update(integrations)
            .set({
              // Always something to set, also when only policies or secrets change.
              updatedAt: new Date().toISOString(),
              ...fields,
              // An empty path means "none" (or "the detected folder").
              ...(slicerConfigDir !== undefined && { slicerConfigDir: slicerConfigDir || null }),
              ...(slicerPath !== undefined && { slicerPath: slicerPath || null }),
              ...(nextConfig && { config: nextConfig }),
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
        // Another device: the old one may stop slicing, the new one starts.
        if (config && adapter?.kind === "worker") {
          const before = workerDeviceId(adapter.kind, cur.config);
          const after = workerDeviceId(adapter.kind, get(cur.id).config);
          if (before !== after) for (const d of [before, after]) if (d) workers.syncWorker(d);
        }
        return toApi(get(cur.id));
      },
    );

    // The hub's slicer of a slicer type (ADR-0022): the only install that slices and feeds its
    // catalog. A machine is asked first (409 `device_outdated` from a connector that can't send).
    app.put(
      "/slicers/:library",
      {
        schema: {
          params: z.object({ library: z.string().max(100) }),
          body: hubSlicerPickSchema,
          response: {
            204: z.null(),
            409: apiErrorSchema,
            422: apiErrorSchema,
            502: apiErrorSchema,
            504: apiErrorSchema,
          },
        },
      },
      async (req, reply) => {
        await pickHubSlicer(db, syncer.adapters, req.params.library, req.body.integrationId, (d) =>
          catalog.confirm(d),
        );
        // The new source starts sending, an old one stops; receivers hear of the new copy.
        await catalog.tell();
        return reply.status(204).send(null);
      },
    );

    // Imported rows stay; their integrationId becomes null (FK `set null`). The sync log cascades.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        const row = get(req.params.id);
        if (syncer.running.has(req.params.id))
          throw new HttpError(409, "sync_running", "A sync is running");
        // A server or worker integration's slicer goes with it.
        if (workers.isWorker(req.params.id)) await workers.remove(req.params.id, false);
        installer.remove(req.params.id, false);
        db.delete(integrations).where(eq(integrations.id, req.params.id)).run();
        syncer.dropAvatar(req.params.id);
        const kind = syncer.adapters.find((a) => a.id === row.adapterId)?.kind;
        const deviceId = workerDeviceId(kind, row.config);
        if (deviceId) workers.syncWorker(deviceId);
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
          await syncer.refreshProfile(row.id);
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

    // The account's photo, through the server (ADR-0021).
    app.get("/:id/avatar", { schema: { params } }, async (req, reply) => {
      const photo = await syncer.avatar(req.params.id);
      if (!photo) throw new HttpError(404, "not_found", "No photo");
      return reply
        .type(photo.type)
        .header("cache-control", "private, max-age=86400")
        .send(photo.body);
    });

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
