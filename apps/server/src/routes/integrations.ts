import { randomBytes } from "node:crypto";
import {
  accountConfigOf,
  accountMode,
  adapterInfoSchema,
  apiErrorSchema,
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
  isNetworkPrinter,
  isSlicerKind,
  isUserPresetType,
  type LoginInput,
  type LoginResult,
  listQuery,
  loginInputSchema,
  loginResultSchema,
  type NewLoginResult,
  newLoginInputSchema,
  newLoginResultSchema,
  type Page,
  PRINTER_SERIAL_FIELD,
  type PrinterChoice,
  pageOf,
  printsLineOf,
  type SyncRun,
  type SyncType,
  slicerCheckSchema,
  slicerInstallSchema,
  slicerInstallStatusSchema,
  slicerReleaseSchema,
  sourceTestInputSchema,
  sourceTestResultSchema,
  syncRequestSchema,
  syncResultSchema,
  syncRunFilters,
  syncRunSchema,
  syncRunSortFields,
  syncTypes,
  syncTypesRequestSchema,
  syncTypesResultSchema,
  testResultSchema,
  tryOut,
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
  hubSlicer,
  policyOf,
  presetLibrary,
  unavailable,
  workerDevice,
} from "../integrations/capabilities.ts";
import { pickHubSlicer } from "../integrations/catalogSource.ts";
import type { DeviceCatalog } from "../integrations/deviceCatalog.ts";
import type { SlicerInstaller } from "../integrations/managedSlicer.ts";
import {
  type FoundLink,
  linkedPrinter,
  linkNetworkPrinter,
  sourceConfig,
} from "../integrations/printerSources.ts";
import { readSecrets, writeSecrets } from "../integrations/secrets.ts";
import type { ServerPresets } from "../integrations/serverPresets.ts";
import { programExists, type SlicerProgram } from "../integrations/slicerProgram.ts";
import type { SourceBridge } from "../integrations/sourceBridge.ts";
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

/**
 * Removes an integration and the slicer that goes with a server or worker one (Remove in
 * Integrations, and a machine's Use slicer as server worker turned off). 409 while it syncs.
 */
export async function removeIntegration(
  db: Db,
  syncer: Syncer,
  installer: SlicerInstaller,
  workers: WorkerSlicers,
  row: typeof integrations.$inferSelect,
) {
  if (syncer.running.has(row.id)) throw new HttpError(409, "sync_running", "A sync is running");
  if (workers.isWorker(row.id)) await workers.remove(row.id, false);
  installer.remove(row.id, false);
  db.delete(integrations).where(eq(integrations.id, row.id)).run();
  syncer.dropAvatar(row.id);
  const kind = syncer.adapters.find((a) => a.id === row.adapterId)?.kind;
  const deviceId = workerDeviceId(kind, row.config);
  if (deviceId) workers.syncWorker(deviceId);
}

/** Removes every worker integration that slices on a device (its Use slicer as server worker off). */
export async function removeWorkersOf(
  db: Db,
  syncer: Syncer,
  installer: SlicerInstaller,
  workers: WorkerSlicers,
  deviceId: string,
) {
  for (const row of db.select().from(integrations).all()) {
    const kind = syncer.adapters.find((a) => a.id === row.adapterId)?.kind;
    if (workerDeviceId(kind, row.config) === deviceId)
      await removeIntegration(db, syncer, installer, workers, row);
  }
}

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
    /** This server's own install receives user presets (5.5.0 Step 11i). */
    presets: Pick<ServerPresets, "pass"> = { pass: async () => {} },
    /** Printers reached through a connector (ADR-0015, LAN reach). */
    bridge?: Pick<SourceBridge, "check" | "test">,
    /** Finds a new local slicer's program on this computer (6.2.0 Step 3g). */
    program: Pick<SlicerProgram, "fill"> = { fill: async () => false },
  ): FastifyPluginAsyncZod =>
  async (app) => {
    /** A worker's slicer is on its device; a server's is here. */
    const slicerOf = (id: string) => (workers.isWorker(id) ? workers : installer);
    // ponytail: a sign-in waiting for its code lives in memory; a restart means starting over.
    const pendingLogins = new Map<string, { state: string; expires: number }>();
    // A new account's sign-in, by its opaque token: nothing is in the database yet (Step 10c).
    const pendingNew = new Map<
      string,
      { adapterId: string; config: unknown; state: string; expires: number }
    >();
    /**
     * Who a new account is, from the secrets its sign-in returned (ADR-0021). Best effort: a failed
     * read leaves it to the first sync.
     */
    const profileOf = async (
      adapter: (typeof syncer.adapters)[number],
      config: unknown,
      secrets: Record<string, string>,
      log: ReturnType<FastifyRequest["log"]["child"]>,
    ) => {
      const kept = { ...secrets };
      try {
        const instance = adapter.create?.({
          config,
          secrets: {
            get: async (k) => kept[k],
            set: async (k, v) => {
              kept[k] = v;
            },
            delete: async (k) => {
              delete kept[k];
            },
          },
          log,
          signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
        });
        return await instance?.profile?.();
      } catch {
        log.warn("account profile not read");
        return undefined;
      }
    };
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
      const { secrets, config, slicerConfigDir, slicerPath, slicerArgs, slicerVersion, ...rest } =
        full;
      const { catalogFingerprint: _, presetState: __, ...row } = rest;
      const adapter = syncer.adapters.find((a) => a.id === row.adapterId);
      const profile = accountConfigOf(config);
      // A slicer install never syncs: it's there or it isn't.
      const local =
        adapter &&
        isSlicerKind(adapter.kind) &&
        (unavailable(full, adapter) ? "unavailable" : "ok");
      return {
        ...row,
        ...(admin && {
          config,
          slicerConfigDir,
          slicerPath,
          slicerArgs,
          slicerVersion,
          // This computer's slicer without a program that exists: slicing is off, and says why.
          ...(adapter?.kind === "local" && { slicerProgramMissing: !programExists(full) }),
          hasSecrets: !!secrets,
          // Which keys are stored (never their values): the edit form says which it keeps.
          storedKeys: secrets ? Object.keys(readSecrets(db, key, full.id)) : [],
        }),
        kind: adapter?.kind ?? "cloud",
        presetLibrary: adapter ? presetLibrary(adapter) : null,
        deviceName: adapter?.kind === "worker" ? (workerDevice(db, full)?.name ?? null) : null,
        viaDeviceName: full.deviceId
          ? (db
              .select({ name: schema.devices.name })
              .from(schema.devices)
              .where(eq(schema.devices.id, full.deviceId))
              .get()?.name ?? null)
          : null,
        account:
          adapter && !isSlicerKind(adapter.kind)
            ? {
                email: profile.email ?? null,
                name: profile.name ?? null,
                avatar: !!profile.avatarUrl,
              }
            : null,
        status: syncer.running.has(row.id) ? "syncing" : local || row.status,
        capabilities: activeCapabilities(db, syncer.adapters, full),
        ...(isNetworkPrinter(adapter) && { printerId: linkedPrinter(db, row.id)?.id ?? null }),
        // A printer on the network has no printers line: it is one printer (ADR-0015).
        policies: (adapter ? syncTypes(adapter) : []).map((type) => {
          const p = policyOf(db, row.id, type);
          const { mode, frequency, lastRunAt, pending, alertSeverities, trackUsage } = p;
          const { scope, merge, newWeight, newOpenedAt, atMinute, atHour, atWeekday, atDay } = p;
          const { editorSync, editorReview, reviewPolicy, recordPrints } = p;
          return {
            type,
            mode,
            frequency,
            lastRunAt,
            pending,
            alertSeverities,
            trackUsage,
            recordPrints,
            reviewPolicy,
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
        configAnyOf: [...(a.configAnyOf ?? [])],
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
      if (!isSlicerKind(adapter.kind)) return;
      const library = presetLibrary(adapter);
      const twice = db
        .select()
        .from(integrations)
        .all()
        .some((r) => {
          const a = syncer.adapters.find((x) => x.id === r.adapterId);
          if (r.id === except || !a || !isSlicerKind(a.kind) || presetLibrary(a) !== library)
            return false;
          return adapter.kind === "worker"
            ? workerDeviceId(a.kind, r.config) === deviceId
            : a.kind !== "worker";
        });
      if (twice)
        throw new HttpError(409, "slicer_exists", "This slicer is already on that machine");
    };

    /**
     * One source per adapter that takes usage back: its spools are keyed by adapter
     * (`<adapter>:<id>`), so two would write one print to both.
     */
    const usageTargetExists = (adapter: (typeof syncer.adapters)[number]) => {
      if (!adapter.capabilities.includes("spoolUsage")) return;
      const twice = db
        .select({ id: integrations.id })
        .from(integrations)
        .where(eq(integrations.adapterId, adapter.id))
        .get();
      if (twice) throw new HttpError(409, "integration_exists", "This source is already set up");
    };

    const isAdmin = (req: FastifyRequest) =>
      !req.user || req.user.rights.permissions["integrations.manage"];

    /**
     * A printer reached through a machine's connector: `hub.manage` picks the machine (ADR-0015).
     * null = this server reaches it.
     */
    const mayPickMachine = (req: FastifyRequest) => {
      const rights = req.user?.rights;
      if (rights && !rights.admin && !rights.permissions["hub.manage"])
        throw new HttpError(403, "forbidden", "Not allowed for your role");
    };
    const checkVia = (
      req: FastifyRequest,
      adapter: (typeof syncer.adapters)[number],
      deviceId: string | null,
    ) => {
      mayPickMachine(req);
      if (deviceId === null) return;
      if (!bridge) throw new HttpError(409, "hub_off", "The hub is off");
      bridge.check(adapter, deviceId);
    };

    /**
     * Tries a source out with these values (`tryOut`), here or through the machine it is reached
     * from: Test before saving, and the save of a printer on the network. `printer`: whose serial
     * a source that reads it uses; `saved`: the source being edited, linked to one already.
     */
    const probe = async (
      adapter: (typeof syncer.adapters)[number],
      config: unknown,
      keys: Record<string, string>,
      deviceId: string | null,
      printer?: PrinterChoice,
      saved?: typeof integrations.$inferSelect,
    ) => {
      const values = parse(
        adapter.configSchema,
        sourceConfig(db, { id: saved?.id, config }, adapter, printer),
        "invalid_config",
      );
      if (!deviceId)
        return tryOut(adapter, {
          config: values,
          secrets: keys,
          log: app.log.child({ adapterId: adapter.id }),
        });
      if (!bridge) throw new HttpError(409, "hub_off", "The hub is off");
      bridge.check(adapter, deviceId);
      return bridge.test(deviceId, adapter, values, keys);
    };

    /**
     * What a printer on the network says it is, to link it at save (ADR-0015). Nothing is saved
     * when it doesn't answer: 422 with the source's error code, as Test shows it.
     */
    const foundPrinter = async (...args: Parameters<typeof probe>): Promise<FoundLink> => {
      const result = await probe(...args);
      if (!result.ok) throw new HttpError(422, result.code, "The printer didn't answer");
      const [found] = result.printers;
      if (!found) throw new HttpError(422, "no_printer", "The source names no printer");
      if (!found.externalId)
        throw new HttpError(409, "device_outdated", "The connector is too old for this source");
      return { ...found, externalId: found.externalId };
    };

    /**
     * The serial belongs to the printer (ADR-0015): once the printer has one, a source that reads
     * it doesn't keep its own.
     */
    const withoutSerial = (
      adapter: (typeof syncer.adapters)[number],
      config: Record<string, unknown>,
      printerId: string,
    ) => {
      if (
        !(PRINTER_SERIAL_FIELD in config) ||
        !sourceConfig(db, { config: {} }, adapter, printerId)[PRINTER_SERIAL_FIELD]
      )
        return config;
      const { [PRINTER_SERIAL_FIELD]: _, ...rest } = config;
      return rest;
    };

    /**
     * A new row with its secrets and default policies: Save on the add form, and a new account
     * once its sign-in went through (6.1.0 Step 10c). `link`: the printer a network source is.
     */
    const insertIntegration = (
      adapter: (typeof syncer.adapters)[number],
      values: typeof integrations.$inferInsert,
      secrets: Record<string, string>,
      link?: false | { found: FoundLink; printer: PrinterChoice; printerName?: string },
    ) =>
      db.transaction(() => {
        const row = db.insert(integrations).values(values).returning().get();
        writeSecrets(db, key, row.id, secrets);
        if (link) {
          const printerId = linkNetworkPrinter(
            db,
            syncer.adapters,
            row.id,
            link.found,
            link.printer,
            link.printerName,
          );
          db.update(integrations)
            .set({
              config: withoutSerial(adapter, row.config as Record<string, unknown>, printerId),
            })
            .where(eq(integrations.id, row.id))
            .run();
        }
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
        if (!isSlicerKind(adapter.kind))
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
          response: { 201: integrationSchema, 409: apiErrorSchema, 422: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const {
          adapterId,
          enabled,
          config,
          secrets,
          deviceId: via,
          printer,
          printerName,
        } = req.body;
        const adapter = adapterOf(adapterId);
        if (via) checkVia(req, adapter, via);
        // A printer on the network is one printer, linked now (ADR-0015).
        const network = isNetworkPrinter(adapter);
        if (network && !printer)
          throw new HttpError(400, "printer_required", "Pick the printer it is, or a new one");
        const values = {
          adapterId,
          enabled,
          config: parse(
            adapter.configSchema,
            network ? sourceConfig(db, { config }, adapter, printer) : config,
            "invalid_config",
          ),
          ...(via && { deviceId: via }),
        };
        const plain = parse(adapter.secretsSchema, secrets, "invalid_secrets");
        const deviceId = workerDeviceId(adapter.kind, values.config);
        slicerExists(adapter, deviceId);
        usageTargetExists(adapter);
        const found =
          network && printer
            ? await foundPrinter(
                adapter,
                config,
                plain as Record<string, string>,
                via ?? null,
                printer,
              )
            : undefined;
        const id = insertIntegration(
          adapter,
          values,
          plain as Record<string, string>,
          found && printer ? { found, printer, printerName } : undefined,
        );
        if (deviceId) workers.syncWorker(deviceId);
        await program.fill(get(id));
        return reply.status(201).send(toApi(get(id)));
      },
    );

    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: integrationPatchSchema,
          response: {
            200: integrationSchema,
            ...notFound,
            409: apiErrorSchema,
            422: apiErrorSchema,
          },
        },
      },
      async (req) => {
        const cur = get(req.params.id);
        const { config, secrets, slicerConfigDir, slicerPath, policies, printer, ...fields } =
          req.body;
        // ADR-0020, ADR-0023: catalog import cards (presets too) need catalog manage, everything
        // else integrations.manage.
        const rights = req.user?.rights;
        if (rights && !rights.admin) {
          const catalog = policies?.some((p) => isCatalogType(p.type));
          const other =
            Object.keys(req.body).some((k) => k !== "policies") ||
            policies?.some((p) => !isCatalogType(p.type));
          if (
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
        // Receive catalog (5.5.0 Step 11c): the server's desktop slicer only, never the hub's slicer.
        const { catalogReceive } = fields;
        if (catalogReceive !== undefined) {
          const lib = adapterOf(cur.adapterId);
          if (lib.kind !== "local" || !lib.desktop || !lib.library)
            throw new HttpError(400, "not_local", "Only a slicer on this computer receives");
          if (catalogReceive && hubSlicer(db, syncer.adapters, lib.library.id)?.row.id === cur.id)
            throw new HttpError(409, "hub_slicer", "It is this slicer's hub's slicer");
          if (!catalogReceive) Object.assign(fields, { catalogInstall: null });
        }
        // Receive user presets (5.5.0 Step 11i): any slicer on this computer, as a machine.
        const { presetReceive } = fields;
        if (presetReceive !== undefined) {
          const lib = adapterOf(cur.adapterId);
          if (lib.kind !== "local" || !lib.desktop || !lib.library)
            throw new HttpError(400, "not_local", "Only a slicer on this computer receives");
          if (!presetReceive) Object.assign(fields, { presetInstall: null });
        }
        if (fields.deviceId !== undefined && fields.deviceId !== cur.deviceId)
          checkVia(req, adapterOf(cur.adapterId), fields.deviceId);
        const adapter = config || secrets || policies ? adapterOf(cur.adapterId) : undefined;
        // The server's own fields (ADR-0021) survive a new config: a client never writes them.
        const kept = accountConfigOf(cur.config);
        const nextConfig =
          config && adapter
            ? {
                ...parse(
                  adapter.configSchema,
                  // Checked with its printer's serial, which isn't kept (`withoutSerial`).
                  sourceConfig(db, { id: cur.id, config }, adapter, printer),
                  "invalid_config",
                ),
                ...kept,
              }
            : undefined;
        // A worker moved to another machine: that one may have this slicer already.
        if (nextConfig && adapter?.kind === "worker") {
          const to = workerDeviceId(adapter.kind, nextConfig);
          if (to !== workerDeviceId(adapter.kind, cur.config)) slicerExists(adapter, to, cur.id);
        }
        for (const p of policies ?? [])
          if (
            !(adapter && syncTypes(adapter).includes(p.type)) ||
            (isAction(p.type) && p.mode === "auto") ||
            // Record prints is a network printer's, on the line that keeps its prints' settings.
            (p.recordPrints !== undefined &&
              !(isNetworkPrinter(adapter) && printsLineOf(adapter.capabilities) === p.type))
          )
            throw new HttpError(400, "invalid_policy", `No such policy for "${p.type}"`);
        // A printer on the network (ADR-0015): another printer moves the link; one with no link
        // yet gets one with its new setup. Either way it is asked what it is first.
        const source = adapterOf(cur.adapterId);
        const network = isNetworkPrinter(source);
        if (printer !== undefined && !network)
          throw new HttpError(
            400,
            "not_printer_host",
            "Only a printer on the network is one printer",
          );
        const unlinked = network && !linkedPrinter(db, cur.id);
        if (unlinked && config !== undefined && printer === undefined)
          throw new HttpError(400, "printer_required", "Pick the printer it is, or a new one");
        const relink = printer ?? (unlinked && config !== undefined ? "new" : undefined);
        const found = relink
          ? await foundPrinter(
              source,
              nextConfig ?? cur.config,
              parse(
                source.secretsSchema,
                { ...readSecrets(db, key, cur.id), ...secrets },
                "invalid_secrets",
              ) as Record<string, string>,
              fields.deviceId !== undefined ? fields.deviceId : cur.deviceId,
              relink,
              cur,
            )
          : undefined;
        db.transaction(() => {
          for (const { type, ...change } of policies ?? []) {
            // Recording again: what ended while it was off stays out of the next history run.
            const resumed =
              type === "prints" &&
              change.recordPrints === true &&
              !policyOf(db, cur.id, type).recordPrints;
            const set = { ...change, ...(resumed && { cursor: new Date().toISOString() }) };
            if (Object.keys(set).length)
              db.insert(syncPolicies)
                .values({ integrationId: cur.id, type, ...defaultPolicy(type), ...set })
                .onConflictDoUpdate({
                  target: [syncPolicies.integrationId, syncPolicies.type],
                  set,
                })
                .run();
          }
          db.update(integrations)
            .set({
              // Always something to set, also when only policies or secrets change.
              updatedAt: new Date().toISOString(),
              ...fields,
              // An empty path means "none" (or "the detected folder").
              ...(slicerConfigDir !== undefined && { slicerConfigDir: slicerConfigDir || null }),
              // A typed path is the program itself: it replaces a found `flatpak run <id>`.
              ...(slicerPath !== undefined && { slicerPath: slicerPath || null, slicerArgs: null }),
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
          if (found && relink) linkNetworkPrinter(db, syncer.adapters, cur.id, found, relink);
          const printerId = network && linkedPrinter(db, cur.id)?.id;
          if (printerId)
            db.update(integrations)
              .set({
                config: withoutSerial(
                  source,
                  get(cur.id).config as Record<string, unknown>,
                  printerId,
                ),
              })
              .where(eq(integrations.id, cur.id))
              .run();
        });
        // Another device: the old one may stop slicing, the new one starts.
        if (config && adapter?.kind === "worker") {
          const before = workerDeviceId(adapter.kind, cur.config);
          const after = workerDeviceId(adapter.kind, get(cur.id).config);
          if (before !== after) for (const d of [before, after]) if (d) workers.syncWorker(d);
        }
        if (catalogReceive) await catalog.tell();
        if (presetReceive) await presets.pass();
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

    // Remove integration: every row of a card (its adapters' library, or the adapter's own id).
    // One running sync blocks all of it, checked before anything is removed.
    app.delete(
      "/",
      {
        schema: {
          querystring: z.object({ library: z.string().min(1).max(100) }),
          response: { 200: z.object({ removed: z.array(z.uuid()) }), 409: apiErrorSchema },
        },
      },
      async (req) => {
        const rows = db
          .select()
          .from(integrations)
          .all()
          .filter((r) => {
            const a = syncer.adapters.find((x) => x.id === r.adapterId);
            return (a ? presetLibrary(a) : r.adapterId) === req.query.library;
          });
        if (rows.some((r) => syncer.running.has(r.id)))
          throw new HttpError(409, "sync_running", "A sync is running");
        for (const row of rows) await removeIntegration(db, syncer, installer, workers, row);
        return { removed: rows.map((r) => r.id) };
      },
    );

    // Imported rows stay; their integrationId becomes null (FK `set null`). The sync log cascades.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        await removeIntegration(db, syncer, installer, workers, get(req.params.id));
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

    // Test before saving (6.0.0 Step 16): the add or edit form's values, nothing stored. Through
    // the machine it will be reached from, whose connector tests it on its own network. The keys
    // are never logged: only the adapter's own lines, as for a saved source.
    app.post(
      "/test",
      {
        schema: {
          body: sourceTestInputSchema,
          response: { 200: sourceTestResultSchema, ...notFound, 409: apiErrorSchema },
        },
      },
      async (req) => {
        const { adapterId, integrationId, deviceId = null, config, secrets, printer } = req.body;
        const adapter = adapterOf(adapterId);
        if (isSlicerKind(adapter.kind) || !adapter.create)
          throw new HttpError(409, "capability_unavailable", "Nothing to test");
        const saved = integrationId ? get(integrationId) : undefined;
        if (saved && saved.adapterId !== adapterId)
          throw new HttpError(400, "adapter_mismatch", "Another kind of source");
        // A key left empty on the Edit page is the stored one: it never goes to the browser.
        const keys = parse(
          adapter.secretsSchema,
          { ...(saved && readSecrets(db, key, saved.id)), ...secrets },
          "invalid_secrets",
        ) as Record<string, string>;
        if (deviceId !== (saved?.deviceId ?? null)) mayPickMachine(req);
        return probe(adapter, config, keys, deviceId, printer, saved);
      },
    );

    /**
     * A new account signs in before it is saved (6.1.0 Step 10c): the config and email + password
     * start it, a challenge is kept against a short-lived opaque token, and the token with the code
     * finishes it. Only a sign-in that went through creates the row; a failure, a cancel or an
     * expired token saves nothing.
     */
    app.post(
      "/login",
      {
        schema: {
          body: newLoginInputSchema,
          response: { 200: newLoginResultSchema, 409: apiErrorSchema },
        },
      },
      async (req): Promise<NewLoginResult> => {
        const now = Date.now();
        for (const [token, p] of pendingNew) if (p.expires < now) pendingNew.delete(token);
        let start: { adapterId: string; config: unknown };
        let input: LoginInput;
        let token: string | undefined;
        if ("token" in req.body) {
          token = req.body.token;
          const pending = pendingNew.get(token);
          if (!pending)
            throw new HttpError(409, "login_not_started", "Sign in with email and password first");
          start = pending;
          input = { code: req.body.code, state: pending.state };
        } else {
          const { adapterId, config, email, password } = req.body;
          start = { adapterId, config };
          input = { email, password };
        }
        const adapter = adapterOf(start.adapterId);
        const login = adapter.login;
        if (!login) throw new HttpError(400, "login_unsupported", "No sign-in for this adapter");
        const config = parse(adapter.configSchema, start.config, "invalid_config");
        usageTargetExists(adapter);
        const log = req.log.child({ adapterId: adapter.id });
        try {
          const signal = AbortSignal.timeout(LOGIN_TIMEOUT_MS);
          const step = await login({ config, log, signal }, input);
          if ("challenge" in step) {
            token ??= randomBytes(24).toString("base64url");
            pendingNew.set(token, {
              adapterId: adapter.id,
              config,
              state: step.state,
              expires: Date.now() + LOGIN_TTL_MS,
            });
            return { status: "challenge", challenge: step.challenge, token };
          }
          if (token) pendingNew.delete(token);
          const profile = await profileOf(adapter, config, step.secrets, log);
          const email = profile?.email?.toLowerCase();
          const twice =
            email &&
            db
              .select()
              .from(integrations)
              .where(eq(integrations.adapterId, adapter.id))
              .all()
              .some((r) => accountConfigOf(r.config).email?.toLowerCase() === email);
          if (twice)
            throw new HttpError(409, "integration_exists", "This account is already set up");
          const id = insertIntegration(
            adapter,
            {
              adapterId: adapter.id,
              config: {
                ...(config as object),
                ...(profile && {
                  email: profile.email,
                  name: profile.name,
                  avatarUrl: profile.avatarUrl,
                }),
              },
            },
            step.secrets,
          );
          // Import the printers right away; the card shows "syncing", failures land in the sync log.
          syncer.run(id, "manual", { type: "printers" }).catch(() => {});
          return { status: "ok", integration: toApi(get(id)) };
        } catch (e) {
          if (e instanceof HttpError) throw e;
          if (e instanceof IntegrationError) return { status: "error", code: e.code };
          log.warn({ err: e }, "sign-in failed");
          return { status: "error", code: "unknown" };
        }
      },
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

    // A page's Sync (Printers, Filament, Prints, Catalog): its types in every Auto source the
    // caller may sync. Others are left out, not refused: the button only offers those.
    app.post(
      "/sync",
      { schema: { body: syncTypesRequestSchema, response: { 200: syncTypesResultSchema } } },
      async (req) => {
        const may = (id: string, type: SyncType) => {
          try {
            mayTask(db, req.user, id, type, "editorSync");
            return true;
          } catch {
            return false;
          }
        };
        return { results: await syncer.runTypes(req.body.types, may) };
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
