import type { ServerResponse } from "node:http";
import { type PrinterStatus, printerStatusSchema } from "@3d-maker-suite/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { PrinterStatusRunner } from "../integrations/printerStatus.ts";

/** A comment line now and then, so a proxy doesn't close a stream that has nothing to say. */
const KEEP_ALIVE_MS = 25_000;

/**
 * What each printer is doing now (ADR-0015), read with `printers` read (ADR-0012): the list, and
 * the same list again over SSE whenever a printer's status changes.
 */
export const printerStatusRoutes =
  (status: PrinterStatusRunner): FastifyPluginAsyncZod =>
  async (app) => {
    const open = new Set<ServerResponse>();
    app.addHook("onClose", async () => {
      for (const res of open) res.end();
    });

    app.get("/", { schema: { response: { 200: z.array(printerStatusSchema) } } }, async () =>
      status.all(),
    );

    app.get("/events", async (req, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      });
      const send = (all: PrinterStatus[]) => res.write(`data: ${JSON.stringify(all)}\n\n`);
      send(status.all());
      open.add(res);
      const off = status.subscribe(send);
      const ping = setInterval(() => res.write(": ping\n\n"), KEEP_ALIVE_MS).unref();
      req.raw.on("close", () => {
        clearInterval(ping);
        off();
        open.delete(res);
      });
    });
  };
