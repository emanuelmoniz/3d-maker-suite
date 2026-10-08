import {
  apiErrorSchema,
  idList,
  listQuery,
  type Page,
  type PrintDetail,
  type PrintUsageInput,
  pageOf,
  printDetailSchema,
  printInputSchema,
  printPatchSchema,
  printSortFields,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { inIds, listPage, taggedWith } from "../lib/list.ts";
import { readPreferences } from "../lib/preferences.ts";
import { setRemaining } from "../lib/spools.ts";

const { prints, printFilamentUsages, printers, projects, spools } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
const round = (g: number) => Math.round(g * 1000) / 1000;

export const printsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const usagesOf = (printIds: string[]) =>
      db
        .select()
        .from(printFilamentUsages)
        .where(inArray(printFilamentUsages.printId, printIds))
        .all();
    const detail = (id: string) => {
      const row = db.select().from(prints).where(eq(prints.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Print not found");
      return { ...row, usages: usagesOf([id]) } as PrintDetail;
    };

    const checkRefs = (
      b: { printerId?: string; projectId?: string | null; failureReason?: string | null },
      was?: string | null,
    ) => {
      if (b.printerId && !db.select().from(printers).where(eq(printers.id, b.printerId)).get())
        throw new HttpError(400, "invalid_printer", "Printer not found");
      if (b.projectId && !db.select().from(projects).where(eq(projects.id, b.projectId)).get())
        throw new HttpError(400, "invalid_project", "Project not found");
      if (
        b.failureReason &&
        b.failureReason !== was &&
        !readPreferences(db).failureReasons.includes(b.failureReason)
      )
        throw new HttpError(
          400,
          "invalid_failure_reason",
          `Unknown failure reason "${b.failureReason}"`,
        );
    };

    // An explicit energy value is "measured". Otherwise estimate from printer power x duration.
    const energy = (
      printerId: string,
      durationSec: number | null,
      override: number | null | undefined,
    ) => {
      if (override != null) return { energyWh: override, energySource: "measured" as const };
      const powerW = db.select().from(printers).where(eq(printers.id, printerId)).get()?.powerW;
      return powerW && durationSec
        ? { energyWh: (powerW * durationSec) / 3600, energySource: "estimated" as const }
        : { energyWh: null, energySource: null };
    };

    /**
     * Replaces a print's filament rows and books the net difference per spool in the ledger
     * (append-only: an edit or delete adds a "print" entry, it never rewrites history).
     * Throws inside the caller's transaction, which rolls everything back.
     */
    const syncUsages = (
      tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
      printId: string,
      title: string,
      next: PrintUsageInput[],
    ) => {
      const old = tx
        .select()
        .from(printFilamentUsages)
        .where(eq(printFilamentUsages.printId, printId))
        .all();
      const net = new Map<string, number>(); // spoolId -> grams to give back (+) or take (-)
      for (const u of old) if (u.spoolId) net.set(u.spoolId, (net.get(u.spoolId) ?? 0) + u.grams);
      for (const u of next) net.set(u.spoolId, (net.get(u.spoolId) ?? 0) - u.grams);

      const profileOf = new Map<string, string>();
      for (const [spoolId, grams] of net) {
        const spool = tx.select().from(spools).where(eq(spools.id, spoolId)).get();
        if (!spool) throw new HttpError(400, "invalid_spool", "Spool not found");
        profileOf.set(spoolId, spool.profileId);
        const remaining = round(spool.remainingGrams + grams);
        if (remaining < 0)
          throw new HttpError(400, "insufficient_filament", "Spool has less filament than used");
        if (round(grams) !== 0) setRemaining(tx, spoolId, "print", remaining, title);
      }
      tx.delete(printFilamentUsages).where(eq(printFilamentUsages.printId, printId)).run();
      if (next.length)
        tx.insert(printFilamentUsages)
          .values(
            next.map((u) => ({
              printId,
              spoolId: u.spoolId,
              profileId: profileOf.get(u.spoolId),
              grams: u.grams,
              slot: u.slot ?? null,
            })),
          )
          .run();
    };

    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(printSortFields, {
            printerId: idList.optional(),
            projectId: idList.optional(),
            outcome: idList.optional(),
            tagId: idList.optional(),
          }),
          response: { 200: pageOf(printDetailSchema) },
        },
      },
      async (req) => {
        const page = listPage(db, prints, req.query, {
          sort: { startedAt: prints.startedAt, title: prints.title },
          dateColumn: prints.startedAt,
          where: [
            inIds(prints.printerId, req.query.printerId),
            inIds(prints.projectId, req.query.projectId),
            inIds(prints.outcome, req.query.outcome),
            taggedWith(db, "print", prints.id, req.query.tagId),
          ],
        });
        const usages = page.items.length ? usagesOf(page.items.map((p) => p.id)) : [];
        return {
          ...page,
          items: page.items.map((p) => ({
            ...p,
            usages: usages.filter((u) => u.printId === p.id),
          })),
        } as Page<PrintDetail>;
      },
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: printDetailSchema, ...notFound } } },
      async (req) => detail(req.params.id),
    );

    app.post(
      "/",
      { schema: { body: printInputSchema, response: { 201: printDetailSchema } } },
      async (req, reply) => {
        const { usages, energyWh, ...fields } = req.body;
        checkRefs(fields);
        const id = db.transaction((tx) => {
          const row = tx
            .insert(prints)
            .values({
              ...fields,
              ...energy(fields.printerId, fields.durationSec ?? null, energyWh),
            })
            .returning()
            .get();
          syncUsages(tx, row.id, row.title, usages);
          return row.id;
        });
        return reply.status(201).send(detail(id));
      },
    );

    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: printPatchSchema,
          response: { 200: printDetailSchema, ...notFound },
        },
      },
      async (req) => {
        const cur = detail(req.params.id);
        const { usages, energyWh, ...fields } = req.body;
        checkRefs(fields, cur.failureReason);
        const merged = { ...cur, ...fields };
        db.transaction((tx) => {
          tx.update(prints)
            .set({
              ...fields,
              failureReason: merged.outcome === "success" ? null : merged.failureReason,
              // A manual value is kept unless the request replaces it; estimates follow printer/duration.
              ...(energyWh === undefined && cur.energySource === "measured"
                ? {}
                : energy(merged.printerId, merged.durationSec, energyWh)),
            })
            .where(eq(prints.id, cur.id))
            .run();
          if (usages) syncUsages(tx, cur.id, merged.title, usages);
        });
        return detail(cur.id);
      },
    );

    // Hard delete: the filament goes back to its spools through the ledger.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        const cur = detail(req.params.id);
        db.transaction((tx) => {
          syncUsages(tx, cur.id, cur.title, []);
          tx.delete(prints).where(eq(prints.id, cur.id)).run();
        });
        return reply.status(204).send(null);
      },
    );
  };
