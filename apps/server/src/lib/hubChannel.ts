import { randomUUID } from "node:crypto";
import type { DeviceReply, HubEvent } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import type { z } from "zod";
import { HttpError } from "../errors.ts";
import { fsError } from "../routes/fs.ts";
import { readPreferences } from "./preferences.ts";

const { hubEvents } = schema;

/** `port`: the connector's status page port it reported (`X-Connector-Port`). */
type Stream = { write: (frame: string) => void; end: () => void; port?: number | null };
type Waiting = {
  deviceId: string;
  timer?: NodeJS.Timeout;
  done: (reply: DeviceReply) => void;
  fail: (err: Error) => void;
};

const ASK_MS = 10_000;
const frame = (seq: number | null, event: HubEvent) =>
  `${seq === null ? "" : `id: ${seq}\n`}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const offline = () => new HttpError(409, "device_offline", "The device is offline");

/**
 * The hub's side of its devices' event streams (ADR-0014): which are open, queued events, and
 * requests a device answers on `POST /api/hub/device/replies/:requestId`. One per app.
 */
export function createHubChannel(db: Db) {
  const streams = new Map<string, Set<Stream>>();
  const waiting = new Map<string, Waiting>();

  /** A device is online while its event stream is open (and the hub is on). */
  const online = (deviceId: string) => streams.has(deviceId) && readPreferences(db).hubEnabled;

  return {
    online,

    /** An online device's status page port, for the project page's probe; null = not reported. */
    port: (deviceId: string) => [...(streams.get(deviceId) ?? [])].at(-1)?.port ?? null,

    /** Queues an event for a device and sends it now if the device is connected. */
    publish(deviceId: string, event: HubEvent) {
      const { seq } = db
        .insert(hubEvents)
        .values({ deviceId, type: event.type, data: event, createdAt: new Date().toISOString() })
        .returning({ seq: hubEvents.seq })
        .get();
      for (const s of streams.get(deviceId) ?? []) s.write(frame(seq, event));
    },

    /** Sends a live event to every open stream; never stored, so a reconnect doesn't get it. */
    nudge(event: HubEvent) {
      if (!readPreferences(db).hubEnabled) return;
      for (const set of streams.values()) for (const s of set) s.write(frame(null, event));
    },

    /** A stored event, for the replay when a stream opens. */
    frame: (seq: number, event: HubEvent) => frame(seq, event),

    /** Registers an open stream; returns the function that removes it when it closes. */
    attach(deviceId: string, stream: Stream) {
      const set = streams.get(deviceId) ?? new Set();
      streams.set(deviceId, set.add(stream));
      return () => {
        set.delete(stream);
        if (set.size) return;
        streams.delete(deviceId);
        for (const w of waiting.values()) if (w.deviceId === deviceId) w.fail(offline());
      };
    },

    /** Ends a device's streams (revoked), or every stream. */
    end(deviceId?: string) {
      for (const [id, set] of streams)
        if (!deviceId || id === deviceId) for (const s of set) s.end();
    },

    /**
     * Sends a request to an online device and waits for its answer, checked with `result`. 409
     * `device_offline` when it isn't connected (or goes), 504 `device_timeout` after `ms`. The
     * device's OS error (ENOENT, ...) comes back as `error` makes it: by default the same error a
     * local call gives.
     */
    ask<T extends z.ZodType>(
      deviceId: string,
      event: (requestId: string) => HubEvent,
      result: T,
      {
        ms = ASK_MS,
        error = fsError,
      }: { ms?: number; error?: (err: NodeJS.ErrnoException) => Error } = {},
    ): Promise<z.infer<T>> {
      const set = online(deviceId) && streams.get(deviceId);
      if (!set) return Promise.reject(offline());
      const requestId = randomUUID();
      return new Promise<DeviceReply>((resolve, reject) => {
        const settle = () => {
          clearTimeout(w.timer);
          waiting.delete(requestId);
        };
        const w: Waiting = {
          deviceId,
          timer: setTimeout(
            () => w.fail(new HttpError(504, "device_timeout", "The device didn't answer")),
            ms,
          ),
          done: (r) => {
            settle();
            resolve(r);
          },
          fail: (e) => {
            settle();
            reject(e);
          },
        };
        waiting.set(requestId, w);
        // Live only: a request isn't queued, so a reconnect never replays a stale one.
        for (const s of set) s.write(frame(null, event(requestId)));
      }).then((reply) => {
        if (!reply.ok) throw error(Object.assign(new Error(reply.code), { code: reply.code }));
        const parsed = result.safeParse(reply.result);
        if (!parsed.success)
          throw new HttpError(502, "device_bad_reply", "The device's answer is invalid");
        return parsed.data;
      });
    },

    /** A device's answer; false when nothing (of this device) waits for it. */
    answer(deviceId: string, requestId: string, reply: DeviceReply) {
      const w = waiting.get(requestId);
      if (!w || w.deviceId !== deviceId) return false;
      w.done(reply);
      return true;
    },

    /**
     * A request the device answers with a transfer: the 10 s timeout stops (the transfer takes
     * its time), and the caller settles it. Undefined when nothing (of this device) waits.
     */
    claim(deviceId: string, requestId: string) {
      const w = waiting.get(requestId);
      if (!w || w.deviceId !== deviceId) return undefined;
      clearTimeout(w.timer);
      return w;
    },
  };
}

export type HubChannel = ReturnType<typeof createHubChannel>;
