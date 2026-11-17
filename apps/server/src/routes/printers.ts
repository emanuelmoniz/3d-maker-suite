import {
  apiErrorSchema,
  archivedFilter,
  dateRangeQuery,
  type IntegrationAdapter,
  listQuery,
  monitoringKey,
  monitoringOf,
  monitoringRank,
  type Page,
  type Printer,
  type PrinterDetail,
  type PrinterPatch,
  type PrinterRow,
  pageOf,
  printerCommentSchema,
  printerConnectionSchema,
  printerDetailSchema,
  printerFilters,
  printerInputSchema,
  printerPatchSchema,
  printerRowSchema,
  printerSchema,
  printerSortFields,
  printStatsSchema,
  readsPrinterSerial,
  spoolLoadSchema,
  summarizePrints,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { sourcesOfPrinter } from "../integrations/printerSources.ts";
import { readSecrets } from "../integrations/secrets.ts";
import {
  alertTasks,
  archivedAtOf,
  archivedWhere,
  canReference,
  resolveItemAlerts,
} from "../lib/archive.ts";
import { DEFAULT_NOZZLE, machinePresetFor, modelName, printerLabel } from "../lib/catalog.ts";
import { commentRoutes } from "../lib/comments.ts";
import { deleteItem } from "../lib/dependents.ts";
import { imageRoutes } from "../lib/images.ts";
import { dateRange, listPage, taggedWith } from "../lib/list.ts";
import { printerUsageColumns, usageRoutes } from "../lib/maintenance.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import { loadSpool } from "../lib/spoolLoad.ts";

const {
  devices,
  integrations,
  printers,
  printerComments,
  printerModels,
  processPresets,
  prints,
  accessoryInstalls,
  spools,
} = schema;
const { machinePresets } = schema;
type PrinterRecord = typeof printers.$inferSelect;
const params = z.object({ id: z.uuid() });
const brandModel = modelName(printers.modelId);
const usage = printerUsageColumns();
const notFound = { 404: apiErrorSchema };

export const printersRoutes =
  (
    db: Db,
    dataDir: string,
    adapters: IntegrationAdapter[] = [],
    /** Only to name the secrets a source has stored. */
    key?: Buffer,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    /**
     * Where a printer comes from (ADR-0015). Its serial is a source's while one supplies it: one
     * that reads it from the printer (Bambu LAN), else the account that brought it in with it.
     */
    const detail = (row: PrinterRecord): PrinterDetail => {
      const sources = sourcesOfPrinter(db, row.id);
      const adapterOf = (id: string) => adapters.find((a) => a.id === id);
      const from =
        sources.find((s) => readsPrinterSerial(adapterOf(s.adapterId))) ??
        (row.serial?.trim() && row.integrationId
          ? sources.find(
              (s) =>
                s.integrationId === row.integrationId && adapterOf(s.adapterId)?.kind === "cloud",
            )
          : undefined);
      return { ...(row as Printer), sources, serialFrom: from?.integrationId ?? null };
    };
    const get = (id: string) => {
      const row = db.select().from(printers).where(eq(printers.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Printer not found");
      return row;
    };
    const checkState = (state?: string) => {
      if (state !== undefined && !readPreferences(db).printerStates.includes(state))
        throw new HttpError(400, "invalid_state", `Unknown printer state "${state}"`);
    };
    const checkModel = (modelId?: string, was?: string | null) => {
      if (modelId && !canReference(db, printerModels, modelId, was))
        throw new HttpError(400, "invalid_model", "Unknown printer model");
    };
    const checkProcessPreset = (id?: string | null, was?: string | null) => {
      if (id && !canReference(db, processPresets, id, was))
        throw new HttpError(400, "invalid_reference", "Unknown process preset");
    };
    /**
     * The machine preset a save gives the printer: a pick, of its model, sets the nozzle to the
     * pick's; else the one for its model and nozzle when the printer is new, asks for it (null), or
     * its model or nozzle changes.
     */
    const withMachine = <T extends PrinterPatch>(fields: T, cur?: PrinterRecord): T => {
      const modelId = fields.modelId ?? cur?.modelId ?? null;
      const picked = fields.machinePresetId;
      if (picked) {
        const m = db.select().from(machinePresets).where(eq(machinePresets.id, picked)).get();
        if (
          !m ||
          m.printerModelId !== modelId ||
          !canReference(db, machinePresets, picked, cur?.machinePresetId)
        )
          throw new HttpError(400, "invalid_machine_preset", "Not a machine preset of this model");
        return { ...fields, nozzleDiameterMm: m.nozzleDiameterMm };
      }
      const nozzle = fields.nozzleDiameterMm ?? cur?.nozzleDiameterMm ?? DEFAULT_NOZZLE;
      const again =
        !cur || picked === null || modelId !== cur.modelId || nozzle !== cur.nozzleDiameterMm;
      return again ? { ...fields, machinePresetId: machinePresetFor(db, modelId, nozzle) } : fields;
    };
    // Like accessories: nothing stays installed on an archived printer.
    const assertNoAccessories = (id: string) => {
      const installed = db
        .select({ id: accessoryInstalls.id })
        .from(accessoryInstalls)
        .where(and(eq(accessoryInstalls.printerId, id), isNull(accessoryInstalls.removedAt)))
        .get();
      if (installed)
        throw new HttpError(409, "printer_has_accessories", "Remove its accessories first");
    };

    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(printerSortFields, { archived: archivedFilter }, printerFilters),
          response: { 200: pageOf(printerRowSchema) },
        },
      },
      async (req) => {
        // The state is in memory, the list in the database: the ids are worked out per request, so
        // the filter is an IN and the sort a CASE, and paging stays in SQL.
        const live = app.printerStatus.all();
        const keyOf = new Map<string, string>();
        for (const { id } of db.select({ id: printers.id }).from(printers).all())
          keyOf.set(id, monitoringKey(monitoringOf(id, live)));
        const wanted = req.query.monitoring;
        const matching =
          wanted && [...keyOf].filter(([, k]) => wanted.includes(k)).map(([id]) => id);
        const ranked = new Map<number, string[]>();
        for (const [id, k] of keyOf) {
          const r = monitoringRank(k);
          if (r > 0) ranked.set(r, [...(ranked.get(r) ?? []), id]);
        }
        const monitoringSort = ranked.size
          ? sql`CASE ${sql.join(
              [...ranked].map(([r, ids]) => sql`WHEN ${inArray(printers.id, ids)} THEN ${r}`),
              sql` `,
            )} ELSE 0 END`
          : sql`0`;
        return listPage(db, printers, req.query, {
          select: { ...getTableColumns(printers), ...usage },
          sort: {
            // The name starts with the number: sorting by it sorts the name as shown (2 before 10).
            name: printers.number,
            createdAt: printers.createdAt,
            model: brandModel,
            state: printers.state,
            monitoring: monitoringSort,
            powerW: printers.powerW,
            runtimeSec: usage.runtimeSec,
            prints: usage.prints,
            successRate: usage.successRate,
          },
          dateColumn: printers.createdAt,
          filters: {
            name: printerLabel,
            model: brandModel,
            state: printers.state,
            powerW: printers.powerW,
            prints: usage.prints,
            runtimeSec: usage.runtimeSec,
            successRate: usage.successRate,
          },
          where: [
            taggedWith(db, "printer", printers.id, req.query.tagId),
            archivedWhere(printers.archivedAt, req.query.archived),
            matching && inArray(printers.id, matching),
          ],
        }) as Page<PrinterRow>;
      },
    );

    app.post(
      "/",
      {
        schema: {
          body: printerInputSchema,
          response: { 201: printerDetailSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        checkState(req.body.state);
        checkModel(req.body.modelId);
        checkProcessPreset(req.body.processPresetId);
        assertNumberFree(db, printers, "printer", req.body.number);
        const row = db
          .insert(printers)
          .values({ ...withMachine(req.body), number: req.body.number ?? nextNumber(printers) })
          .returning()
          .get();
        return reply.status(201).send(detail(row));
      },
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: printerDetailSchema, ...notFound } } },
      async (req) => detail(get(req.params.id)),
    );

    // Where the printer is read from (ADR-0015). Nothing here is editable and no secret leaves: only
    // the names of the stored ones, with the host, for `integrations.manage` (ADR-0012).
    app.get(
      "/:id/connection",
      { schema: { params, response: { 200: printerConnectionSchema, ...notFound } } },
      async (req) => {
        get(req.params.id);
        const admin = !req.user || req.user.rights.permissions["integrations.manage"];
        const sources = sourcesOfPrinter(db, req.params.id).flatMap((s) => {
          const row = db
            .select()
            .from(integrations)
            .where(eq(integrations.id, s.integrationId))
            .get();
          if (!row) return [];
          const host = (row.config as { host?: unknown } | null)?.host;
          const device = row.deviceId
            ? db
                .select({ name: devices.name })
                .from(devices)
                .where(eq(devices.id, row.deviceId))
                .get()
            : undefined;
          return [
            {
              integrationId: row.id,
              adapterId: row.adapterId,
              enabled: row.enabled,
              deviceId: row.deviceId,
              deviceName: device?.name ?? null,
              ...(admin && {
                host: typeof host === "string" && host.trim() ? host.trim() : null,
                secrets: row.secrets && key ? Object.keys(readSecrets(db, key, row.id)) : [],
              }),
            },
          ];
        });
        return { sources };
      },
    );

    // `archived` archives/restores.
    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: printerPatchSchema,
          response: { 200: printerDetailSchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        const cur = get(req.params.id);
        const { archived, ...fields } = req.body;
        if (
          fields.serial !== undefined &&
          (fields.serial?.trim() || null) !== (cur.serial?.trim() || null) &&
          detail(cur).serialFrom
        )
          throw new HttpError(409, "serial_from_source", "Its source gives this printer's serial");
        checkState(fields.state);
        checkModel(fields.modelId, cur.modelId);
        checkProcessPreset(fields.processPresetId, cur.processPresetId);
        assertNumberFree(db, printers, "printer", fields.number, req.params.id);
        if (archived) assertNoAccessories(req.params.id);
        const row = db.transaction((tx) => {
          const row = tx
            .update(printers)
            .set({ ...withMachine(fields, cur), archivedAt: archivedAtOf(archived) })
            .where(eq(printers.id, req.params.id))
            .returning()
            .get();
          if (archived) resolveItemAlerts(tx, alertTasks.printer(row.id));
          return row;
        });
        return detail(row);
      },
    );

    // A printer with history (prints, maintenance, installs) can only be archived.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), 409: apiErrorSchema, ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        deleteItem(db, "printers", req.params.id, { user: req.user, dataDir });
        return reply.status(204).send(null);
      },
    );

    app.get(
      "/:id/stats",
      {
        schema: {
          params,
          querystring: dateRangeQuery,
          response: { 200: printStatsSchema, ...notFound },
        },
      },
      async (req) => {
        const printer = get(req.params.id);
        const rows = db
          .select({
            durationSec: prints.durationSec,
            outcome: prints.outcome,
            energyWh: prints.energyWh,
          })
          .from(prints)
          .where(and(eq(prints.printerId, printer.id), dateRange(prints.startedAt, req.query)))
          .all();
        return summarizePrints(rows, printer.powerW);
      },
    );

    // The spool in a slot (ADR-0015): new prints there charge it. Loading a spool takes it out of
    // the slot it was in; `null` empties the slot.
    app.put(
      "/:id/slots",
      {
        schema: {
          params,
          body: spoolLoadSchema,
          response: { 204: z.null(), 400: apiErrorSchema, ...notFound },
        },
      },
      async (req, reply) => {
        const printer = get(req.params.id);
        const { slot, spoolId } = req.body;
        if (spoolId) {
          const s = db.select().from(spools).where(eq(spools.id, spoolId)).get();
          if (!s || s.archivedAt)
            throw new HttpError(400, "invalid_reference", "Unknown or archived spool");
        }
        // Yours from now on: only a tag the printer reads replaces it (Step 19b).
        loadSpool(db, printer.id, slot, spoolId, "user");
        return reply.status(204).send(null);
      },
    );

    commentRoutes(app, db, {
      table: printerComments,
      parentKey: "printerId",
      response: printerCommentSchema,
      getParent: get,
    });

    usageRoutes(app, db, { target: "printerId", get });

    imageRoutes(app, dataDir, {
      name: "photo",
      dir: "photos",
      response: printerSchema,
      get: (id) => get(id).photoPath,
      set: (id, photoPath) =>
        db
          .update(printers)
          .set({ photoPath })
          .where(eq(printers.id, id))
          .returning()
          .get() as Printer,
    });
  };
