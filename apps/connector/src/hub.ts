import { Readable } from "node:stream";
import {
  type ConnectorUpdateFailure,
  type DeviceSyncMode,
  HUB_HEARTBEAT_MS,
  type HubEvent,
  hubEventSchema,
  pairResultSchema,
} from "@3d-maker-suite/core";
import { openFolder, systemInfo } from "@3d-maker-suite/host";
import { z } from "zod";
import { createRootSync, type Request } from "./roots.ts";
import { createSlicers } from "./slicers.ts";
import type { Store } from "./state.ts";
import { createHubSync } from "./sync.ts";

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
  /** The status page's port, sent so the hub's project page can find it (`/api/whoami`). */
  port?: number;
  /**
   * Called with the hub's version before each connect; the updater may exit from here. `force`:
   * the hub asked for Update now.
   */
  onHubVersion?: (version: string, force: boolean) => Promise<void>;
  /** Why the update to the hub's version failed, sent when the stream opens. */
  updateFailure?: () => ConnectorUpdateFailure | undefined;
  /** Where the hub roots are synced to, and the data folder for its state file; none = no sync. */
  sync?: { dataDir: string; syncDir: string } & Pick<
    Parameters<typeof createHubSync>[0],
    "alive" | "handoffMs" | "pollMs"
  >;
  /** How slicers are found and started, and folders opened (tests); the real ones by default. */
  slicers?: Pick<
    Parameters<typeof createSlicers>[0],
    "find" | "start" | "smoke" | "install" | "runSlice"
  > & {
    openDir?: (dir: string) => Promise<unknown>;
  };
  log?: (line: string) => void;
};

/**
 * The connector's link to its hub (ADR-0014): pairing, then `GET /api/hub/events` held open,
 * reconnected from the cursor after 1 s, doubling up to 30 s. 401 = revoked: the token goes.
 * While online, its device roots are synced and watched (roots.ts), and so are the hub roots (sync.ts).
 */
export function createLink({
  store,
  version,
  os,
  port,
  onHubVersion,
  updateFailure,
  sync: syncAt,
  slicers: slicerHooks,
  log = () => {},
}: Options) {
  let status: LinkStatus = store.token() ? "connecting" : "unpaired";
  let error: string | undefined;
  /** Reached the stream since the last retry. */
  let online = false;
  let running: AbortController | undefined;
  /** Update now came in: the next connect updates even to a version that rolled back. */
  let forceUpdate = false;

  /** The hub's device API (`/api/hub/device/...`) with this device's token. */
  const request: Request = (path, init = {}) =>
    fetch(`${store.get().hubUrl}/api/hub/device${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${store.token()}`,
        ...(init.body !== undefined && { "content-type": "application/json" }),
        ...(init.file && { "content-type": "application/octet-stream" }),
        ...(init.file?.sha256 && {
          "x-file-sha256": init.file.sha256,
          "x-file-mtime": String(init.file.mtimeMs),
        }),
      },
      body: init.file
        ? (Readable.toWeb(init.file.stream) as ReadableStream)
        : init.body === undefined
          ? undefined
          : JSON.stringify(init.body),
      // A large file over a slow link takes its time; a stalled one ends some time.
      signal: AbortSignal.timeout(init.file || init.long ? 30 * 60_000 : 60_000),
      // A stream body needs it (undici); the DOM's RequestInit type doesn't know it.
      duplex: "half",
    } as RequestInit);
  const roots = createRootSync({ request, log, store });
  const sync =
    syncAt &&
    createHubSync({
      request,
      ...syncAt,
      identity: () => `${store.get().hubUrl}|${store.get().deviceId}`,
      log,
    });
  const { openDir = openFolder, ...slicerFns } = slicerHooks ?? {};
  const slicers = createSlicers({ request, store, log, dataDir: syncAt?.dataDir, ...slicerFns });
  const local = (rootId: string, path: string) =>
    sync ? sync.local(rootId, path) : Promise.resolve(null);
  /** Open folder: the project's synced copy in the file manager, ENOENT when it isn't here. */
  const openSynced = async ({
    requestId,
    rootId,
    path,
  }: Extract<HubEvent, { type: "open.folder" }>) => {
    const abs = await sync?.folder(rootId, path);
    const body = abs
      ? await openDir(abs).then(
          () => ({ ok: true, result: null }),
          (e: NodeJS.ErrnoException) => ({ ok: false, code: e.code ?? "EIO" }),
        )
      : { ok: false, code: "ENOENT" };
    await request(`/replies/${requestId}`, { method: "POST", body }).catch(() => {});
  };
  const toRoots = (event: HubEvent) => {
    roots.handle(event);
    sync?.handle(event);
  };

  const handle = ({ id, data }: SseEvent) => {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return log(`event ${id ?? "request"}: not JSON`);
    }
    const event = hubEventSchema.safeParse(json);
    // A type this version doesn't know is skipped: the connector follows the hub's version.
    // A request has no id: it's live only, never stored or replayed. One it can't carry out is
    // answered at once, so the hub doesn't wait for it.
    if (id === undefined) {
      if (event.success && event.data.type === "open")
        return void slicers.open(event.data, local, (rootId, path, pid) =>
          sync?.opened(rootId, path, pid),
        );
      if (event.success && event.data.type === "open.folder") return void openSynced(event.data);
      if (event.success && event.data.type === "slicer.check")
        return void slicers.check(event.data);
      if (event.success && event.data.type === "slicer.install")
        return void slicers.install(event.data);
      if (event.success && event.data.type === "slicer.remove")
        return void slicers.remove(event.data);
      if (event.success && event.data.type === "slice")
        return void slicers.slice(event.data, (sha) => sync?.copyOf(sha) ?? Promise.resolve(null));
      if (event.success) return toRoots(event.data);
      const requestId = (json as { requestId?: unknown })?.requestId;
      if (typeof requestId === "string" && /^[0-9a-f-]{36}$/i.test(requestId))
        void request(`/replies/${requestId}`, {
          method: "POST",
          body: { ok: false, code: "ENOTSUP" },
        }).catch(() => {});
      return;
    }
    const seq = Number(id);
    if (!Number.isSafeInteger(seq) || seq <= (store.get().cursor ?? 0)) return; // seen already
    if (event.success && event.data.type === "device.renamed")
      store.set({ deviceName: event.data.name, cursor: seq });
    else if (event.success && event.data.type === "device.worker")
      store.set({ sliceWorker: event.data.on, cursor: seq });
    else store.set({ cursor: seq });
    if (!event.success) return;
    // Reconnecting runs the update first, and reports how it went when the stream opens again.
    if (event.data.type === "connector.update") {
      forceUpdate = true;
      return start();
    }
    toRoots(event.data);
  };

  /** One connection: the health check, then the stream until it ends. Returns the next status. */
  async function once(hub: string, token: string, signal: AbortSignal): Promise<LinkStatus> {
    const health = await fetch(`${hub}/api/health`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    const { version: hubVersion } = z.object({ version: z.string() }).parse(await health.json());
    const force = forceUpdate;
    forceUpdate = false;
    await onHubVersion?.(hubVersion, force);
    const failure = updateFailure?.();

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
          "x-connector-system": JSON.stringify(systemInfo()),
          ...(port && { "x-connector-port": String(port) }),
          ...(failure && { "x-connector-update": JSON.stringify(failure) }),
          ...(store.get().cursor && { "last-event-id": String(store.get().cursor) }),
        },
      });
      if (res.status === 401) return "revoked";
      if (res.status === 404) return "hubOff";
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      if (signal.aborted) return "offline";
      store.set({ sliceWorker: res.headers.get("x-slice-worker") === "1" });
      status = "online";
      online = true;
      error = undefined;
      log(`online at ${hub}`);
      void roots.start();
      void sync?.start();
      void slicers.refresh();
      void slicers.prune();
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
      sync?.stop();
      void sync?.offline();
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
    // Until it connects; connecting starts the sync over (and gives files their access back).
    void sync?.offline();
    running = new AbortController();
    void run(running.signal);
  };

  return {
    start,
    close: () => {
      running?.abort();
      roots.stop();
      sync?.stop();
    },
    state: () => ({ status, error }),
    roots,
    sync,
    slicers,
    /** The status page's sync mode switch; the hub answers with `roots.changed`. */
    setMode: (mode: DeviceSyncMode) =>
      request("/sync/mode", { method: "PUT", body: { mode } }).then((res) => {
        if (!res.ok) throw new Error(`sync mode: HTTP ${res.status}`);
      }),

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
