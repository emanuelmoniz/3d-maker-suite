import { HUB_HEARTBEAT_MS, hubEventSchema, pairResultSchema } from "@3d-maker-suite/core";
import { z } from "zod";
import { createRootSync } from "./roots.ts";
import type { Store } from "./state.ts";

export type LinkStatus = "unpaired" | "connecting" | "online" | "offline" | "hubOff" | "revoked";
export type PairErrorCode = "badUrl" | "unreachable" | "invalidCode" | "tooManyAttempts" | "hubOff";
export class PairError extends Error {
  readonly code: PairErrorCode;
  constructor(code: PairErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Three missed heartbeats: the stream is dead even if the socket isn't. */
const WATCHDOG_MS = 3 * HUB_HEARTBEAT_MS;
const MAX_DELAY_MS = 30_000;
/** A hub with the hub switch off: no need to knock every few seconds. */
const HUB_OFF_DELAY_MS = 60_000;

type SseEvent = { id?: string; event?: string; data: string };

/** Feeds text from an SSE body; calls `onEvent` per complete event. Comments (`: hb`) are skipped. */
export function sseParser(onEvent: (e: SseEvent) => void) {
  let buf = "";
  return (text: string) => {
    buf += text;
    for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const e: SseEvent = { data: "" };
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        const at = line.indexOf(":");
        const field = at < 0 ? line : line.slice(0, at);
        const value = at < 0 ? "" : line.slice(at + 1).replace(/^ /, "");
        if (field === "data") data.push(value);
        else if (field === "id" || field === "event") e[field] = value;
      }
      if (data.length) onEvent({ ...e, data: data.join("\n") });
    }
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const t = setTimeout(done, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        done();
      },
      { once: true },
    );
  });
const message = (e: unknown) =>
  e instanceof Error ? ((e.cause as Error | undefined)?.message ?? e.message) : String(e);

type Options = {
  store: Store;
  version: string;
  os: string;
  /** Called with the hub's version before each connect; the updater may exit from here. */
  onHubVersion?: (version: string) => Promise<void>;
  log?: (line: string) => void;
};

/**
 * The connector's link to its hub (ADR-0014): pairing, then `GET /api/hub/events` held open,
 * reconnected from the cursor after 1 s, doubling up to 30 s. 401 = revoked: the token goes.
 * While online, its device roots are synced and watched (roots.ts).
 */
export function createLink({ store, version, os, onHubVersion, log = () => {} }: Options) {
  let status: LinkStatus = store.token() ? "connecting" : "unpaired";
  let error: string | undefined;
  /** Reached the stream since the last retry. */
  let online = false;
  let running: AbortController | undefined;

  /** The hub's device API (`/api/hub/device/...`) with this device's token. */
  const request = (path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${store.get().hubUrl}/api/hub/device${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${store.token()}`,
        ...(init.body !== undefined && { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(60_000),
    });
  const roots = createRootSync({ request, log });

  const handle = ({ id, data }: SseEvent) => {
    let event: ReturnType<typeof hubEventSchema.safeParse>;
    try {
      event = hubEventSchema.safeParse(JSON.parse(data));
    } catch {
      return log(`event ${id ?? "request"}: not JSON`);
    }
    // A type this version doesn't know is skipped: the connector follows the hub's version.
    // A request has no id: it's live only, never stored or replayed.
    if (id === undefined) return event.success && roots.handle(event.data);
    const seq = Number(id);
    if (!Number.isSafeInteger(seq) || seq <= (store.get().cursor ?? 0)) return; // seen already
    if (event.success && event.data.type === "device.renamed")
      store.set({ deviceName: event.data.name, cursor: seq });
    else store.set({ cursor: seq });
    if (event.success) roots.handle(event.data);
  };

  /** One connection: the health check, then the stream until it ends. Returns the next status. */
  async function once(hub: string, token: string, signal: AbortSignal): Promise<LinkStatus> {
    const health = await fetch(`${hub}/api/health`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    const { version: hubVersion } = z.object({ version: z.string() }).parse(await health.json());
    await onHubVersion?.(hubVersion);

    const quiet = new AbortController();
    let watchdog = setTimeout(() => quiet.abort(new Error("no heartbeat")), WATCHDOG_MS);
    try {
      const res = await fetch(`${hub}/api/hub/events`, {
        signal: AbortSignal.any([signal, quiet.signal]),
        headers: {
          authorization: `Bearer ${token}`,
          accept: "text/event-stream",
          "x-connector-version": version,
          "x-connector-os": os,
          ...(store.get().cursor && { "last-event-id": String(store.get().cursor) }),
        },
      });
      if (res.status === 401) return "revoked";
      if (res.status === 404) return "hubOff";
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      if (signal.aborted) return "offline";
      status = "online";
      online = true;
      error = undefined;
      log(`online at ${hub}`);
      void roots.start();
      const parse = sseParser(handle);
      const text = new TextDecoder();
      for await (const chunk of res.body) {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => quiet.abort(new Error("no heartbeat")), WATCHDOG_MS);
        parse(text.decode(chunk, { stream: true }));
      }
      return "offline";
    } finally {
      clearTimeout(watchdog);
      roots.stop();
    }
  }

  async function run(signal: AbortSignal) {
    for (let delay = 1000; !signal.aborted; delay = Math.min(delay * 2, MAX_DELAY_MS)) {
      const token = store.token();
      const hub = store.get().hubUrl;
      if (!token || !hub) {
        status = "unpaired";
        return;
      }
      let next: LinkStatus = "offline";
      let failure: string | undefined;
      try {
        next = await once(hub, token, signal);
      } catch (e) {
        failure = message(e);
      }
      // Stopped or restarted meanwhile: a newer run owns the state now.
      if (signal.aborted) return;
      status = next;
      error = failure;
      log(`${status}${error ? `: ${error}` : ""}`);
      if (status === "revoked") return store.forget();
      // It was online this round: a drop starts the backoff over.
      if (online) delay = 1000;
      online = false;
      await sleep(status === "hubOff" ? HUB_OFF_DELAY_MS : delay, signal);
    }
  }

  const start = () => {
    running?.abort();
    running = new AbortController();
    void run(running.signal);
  };

  return {
    start,
    close: () => {
      running?.abort();
      roots.stop();
    },
    state: () => ({ status, error }),
    roots,

    /** Exchanges a pairing code for a device token, then connects. */
    async pair(hubUrl: string, code: string, name: string) {
      let url: URL;
      try {
        url = new URL(hubUrl.trim());
      } catch {
        throw new PairError("badUrl");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new PairError("badUrl");
      // A hub behind a path prefix (https://x.example/maker) keeps it.
      const hub = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
      const res = await fetch(`${hub}/api/hub/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, name, os, connectorVersion: version }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {
        throw new PairError("unreachable");
      });
      if (res.status === 401 || res.status === 400) throw new PairError("invalidCode");
      if (res.status === 429) throw new PairError("tooManyAttempts");
      if (res.status === 404) throw new PairError("hubOff");
      const result = pairResultSchema.safeParse(await res.json().catch(() => null));
      if (!res.ok || !result.success) throw new PairError("unreachable");
      const { token, deviceId } = result.data;
      store.set({ hubUrl: hub, deviceId, deviceName: name, cursor: 0, token });
      log(`paired with ${hub}`);
      status = "connecting";
      error = undefined;
      start();
    },
  };
}

export type Link = ReturnType<typeof createLink>;
