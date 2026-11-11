import { Readable } from "node:stream";
import {
  type ConnectorSettings,
  type ConnectorSettingsPatch,
  type ConnectorSettingsResult,
  type ConnectorUpdateFailure,
  catalogSourcesSchema,
  type DeviceSyncMode,
  type DeviceUserChange,
  deviceUserPreviewSchema,
  deviceUserResultSchema,
  HUB_HEARTBEAT_MS,
  type HubEvent,
  hubEventSchema,
  pairResultSchema,
  presetSwitchesSchema,
} from "@3d-maker-suite/core";
import { openFolder, systemInfo } from "@3d-maker-suite/host";
import { z } from "zod";
import { createCatalogSend } from "./catalog.ts";
import { createCatalogInstall } from "./catalogInstall.ts";
import { createPresetInstall } from "./presetInstall.ts";
import { createPresetShare, openPresetState } from "./presets.ts";
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
  /** Where slicers' config folders are (tests); the real ones by default. */
  presetConfigDir?: Parameters<typeof createPresetShare>[0]["configDir"];
  /** The process list and the queue's timing (tests); the real ones by default. */
  presetHooks?: Pick<Parameters<typeof createPresetInstall>[0], "processes" | "pollMs">;
  /** How slicers are found and started, and folders opened (tests); the real ones by default. */
  slicers?: Pick<
    Parameters<typeof createSlicers>[0],
    "find" | "start" | "smoke" | "install" | "runSlice"
  > & {
    openDir?: (dir: string) => Promise<unknown>;
  };
  /**
   * The machine page: its settings, read and saved; `restart` ends the process for the launcher,
   * `stop` ends it for good (until login or started by hand).
   */
  settings?: {
    get: () => Omit<ConnectorSettings, "defaultSlicer">;
    set: (
      patch: Pick<ConnectorSettingsPatch, "port" | "autostart">,
    ) => Promise<Omit<ConnectorSettingsResult, "defaultSlicer">>;
    restart: () => void;
    stop: () => void;
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
  presetConfigDir,
  presetHooks,
  slicers: slicerHooks,
  settings,
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
  const presetState =
    syncAt &&
    openPresetState(syncAt.dataDir, () => `${store.get().hubUrl}|${store.get().deviceId}`);
  const presets =
    presetState &&
    createPresetShare({
      request,
      store,
      state: presetState,
      slicers: slicers.described,
      log,
      configDir: presetConfigDir,
    });
  const presetInstall =
    syncAt &&
    presetState &&
    createPresetInstall({
      request,
      store,
      state: presetState,
      slicers: slicers.described,
      dataDir: syncAt.dataDir,
      log,
      configDir: presetConfigDir,
      beforeWrite: () => presets?.flush() ?? Promise.resolve(),
      ...presetHooks,
    });
  const catalog =
    syncAt &&
    createCatalogSend({
      request,
      slicers: slicers.described,
      dataDir: syncAt.dataDir,
      log,
      configDir: presetConfigDir,
    });
  const catalogInstall =
    syncAt &&
    createCatalogInstall({
      request,
      slicers: slicers.described,
      dataDir: syncAt.dataDir,
      log,
      configDir: presetConfigDir,
      ...presetHooks,
    });
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
  const reply = (requestId: string, body: unknown) =>
    request(`/replies/${requestId}`, { method: "POST", body }).catch(() => {});
  /** A request about a code to change this device's user, with the same errors as pairing. */
  const askWithCode = async <T extends z.ZodType>(path: string, body: unknown, result: T) => {
    const res = await request(path, { method: "POST", body }).catch(() => {
      throw new PairError("unreachable");
    });
    if (res.status === 400) throw new PairError("invalidCode");
    if (res.status === 429) throw new PairError("tooManyAttempts");
    if (res.status === 404) throw new PairError("hubOff");
    const answer = result.safeParse(await res.json().catch(() => null));
    if (!res.ok || !answer.success) throw new PairError("unreachable");
    return answer.data as z.infer<T>;
  };
  /**
   * The slicer Open uses: a found one's id, or "" to ask each time. False for one not found here.
   * The hub hears of it with the slicer list.
   */
  const setDefaultSlicer = (id: string) => {
    if (id && !slicers.list().some((f) => f.id === id)) return false;
    store.set({ defaultSlicer: id });
    void slicers.refresh();
    return true;
  };
  /** The machine page's requests; ENOTSUP when this connector has no settings to give (tests). */
  const editSettings = async (
    event: Extract<
      HubEvent,
      {
        type:
          | "connector.settings.get"
          | "connector.settings.set"
          | "connector.restart"
          | "connector.stop";
      }
    >,
  ) => {
    const { requestId } = event;
    if (!settings) return void (await reply(requestId, { ok: false, code: "ENOTSUP" }));
    const defaultSlicer = () => store.get().defaultSlicer ?? "";
    try {
      if (event.type === "connector.settings.get")
        await reply(requestId, {
          ok: true,
          result: { ...settings.get(), defaultSlicer: defaultSlicer() },
        });
      else if (event.type === "connector.settings.set") {
        if (event.defaultSlicer !== undefined && !setDefaultSlicer(event.defaultSlicer))
          return void (await reply(requestId, { ok: false, code: "ENOENT" }));
        const result = await settings.set({ port: event.port, autostart: event.autostart });
        await reply(requestId, { ok: true, result: { ...result, defaultSlicer: defaultSlicer() } });
      } else {
        // Answered first: the hub's request must not time out on a process that is gone.
        await reply(requestId, { ok: true, result: null });
        if (event.type === "connector.stop") settings.stop();
        else settings.restart();
      }
    } catch (e) {
      log(`settings: ${message(e)}`);
      await reply(requestId, { ok: false, code: "EIO" });
    }
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
      if (event.success && event.data.type === "device.user") {
        userName = event.data.name;
        return;
      }
      if (event.success && event.data.type === "open")
        return void slicers.open(event.data, local, (rootId, path, pid) =>
          sync?.opened(rootId, path, pid),
        );
      if (event.success && event.data.type === "open.folder") return void openSynced(event.data);
      if (
        event.success &&
        (event.data.type === "connector.settings.get" ||
          event.data.type === "connector.settings.set" ||
          event.data.type === "connector.restart" ||
          event.data.type === "connector.stop")
      )
        return void editSettings(event.data);
      if (event.success && event.data.type === "projects.share") {
        store.set({ shareProjects: event.data.on });
        void reply(event.data.requestId, { ok: true, result: null });
        roots.handle({ type: "roots.changed" });
        return;
      }
      if (event.success && event.data.type === "slicer.check")
        return void slicers.check(event.data);
      if (event.success && event.data.type === "slicer.install")
        return void slicers.install(event.data);
      if (event.success && event.data.type === "slicer.remove")
        return void slicers.remove(event.data);
      if (event.success && event.data.type === "slice")
        return void slicers.slice(event.data, (sha) => sync?.copyOf(sha) ?? Promise.resolve(null));
      if (event.success && event.data.type === "presets.set") {
        store.set({ presetLibraries: event.data.libraries });
        void reply(event.data.requestId, { ok: true, result: null });
        void presets?.start();
        void presetInstall?.start();
        return;
      }
      if (event.success && event.data.type === "catalog.sources") {
        void reply(event.data.requestId, { ok: true, result: null });
        void catalog?.set(event.data.libraries);
        return;
      }
      if (event.success && event.data.type === "catalog.install") {
        void reply(event.data.requestId, { ok: true, result: null });
        void catalogInstall?.set(event.data.libraries);
        return;
      }
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
      let libraries: unknown;
      let sources: unknown;
      let installs: unknown;
      try {
        libraries = JSON.parse(res.headers.get("x-preset-libraries") ?? "{}");
        sources = JSON.parse(res.headers.get("x-catalog-sources") ?? "{}");
        installs = JSON.parse(res.headers.get("x-catalog-install") ?? "{}");
      } catch {}
      store.set({
        sliceWorker: res.headers.get("x-slice-worker") === "1",
        presetLibraries: z.record(z.string(), presetSwitchesSchema).catch({}).parse(libraries),
        // A hub before 5.5.0 doesn't say: it shares.
        shareProjects: res.headers.get("x-share-projects") !== "0",
      });
      const owner = res.headers.get("x-device-user");
      userName = owner ? decodeURIComponent(owner) : undefined;
      status = "online";
      online = true;
      error = undefined;
      log(`online at ${hub}`);
      void roots.start();
      void sync?.start();
      // Its slicers first: they say which folders to watch.
      void slicers.refresh().then(() => {
        if (signal.aborted || quiet.signal.aborted) return;
        void presets?.start();
        void presetInstall?.start();
        void catalog?.set(catalogSourcesSchema.catch({}).parse(sources));
        void catalogInstall?.set(catalogSourcesSchema.catch({}).parse(installs));
      });
      void slicers.prune();
      void loadBranding(hub, token, signal);
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
      presets?.stop();
      presetInstall?.stop();
      catalog?.stop();
      catalogInstall?.stop();
      void sync?.offline();
    }
  }

  /** The hub user this device acts as: told on every connect, and when it changes (`device.user`). */
  let userName: string | undefined;
  /** The hub's name, logo and favicon (settings any paired device may read), for the status page. */
  type Image = { type: string; data: Buffer };
  let branding: { name?: string; logo?: Image; favicon?: Image } = {};
  async function loadBranding(hub: string, token: string, signal: AbortSignal) {
    const get = (path: string) =>
      fetch(`${hub}/api/${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
    // Only the image types the hub accepts, so the status page never serves anything else.
    const image = async (kind: "logo" | "favicon"): Promise<Image | undefined> => {
      const res = await get(`branding/${kind}`);
      const type = res.headers.get("content-type") ?? "";
      return res.ok && /^image\/(png|jpeg|webp)$/.test(type)
        ? { type, data: Buffer.from(await res.arrayBuffer()) }
        : undefined;
    };
    try {
      const prefs = await get("preferences");
      const name = prefs.ok
        ? ((await prefs.json()) as { values?: { appName?: string } }).values?.appName
        : "";
      branding = {
        name: name || undefined,
        logo: await image("logo"),
        favicon: await image("favicon"),
      };
    } catch {} // keeps what it had; the page falls back to the connector name
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
      if (status === "revoked") {
        branding = {};
        return store.forget();
      }
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
      presets?.stop();
      presetInstall?.stop();
      catalog?.stop();
      catalogInstall?.stop();
    },
    state: () => ({ status, error }),
    branding: () => branding,
    userName: () => userName,
    /**
     * Unpair from this side (the hub is broken or being reinstalled): the token and state go, the
     * stream closes, and the hub shows the device offline until an admin removes it.
     */
    unpair: () => {
      running?.abort();
      roots.stop();
      sync?.stop();
      presets?.stop();
      presetInstall?.stop();
      catalog?.stop();
      catalogInstall?.stop();
      store.forget();
      branding = {};
      userName = undefined;
      status = "unpaired";
      error = undefined;
      online = false;
      log("unpaired");
    },
    roots,
    sync,
    slicers,
    /** The status page's sync mode switch; the hub answers with `roots.changed`. */
    setDefaultSlicer,
    setMode: (mode: DeviceSyncMode) =>
      request("/sync/mode", { method: "PUT", body: { mode } }).then((res) => {
        if (!res.ok) throw new Error(`sync mode: HTTP ${res.status}`);
      }),

    /** Who a code would change this device's user to; the code stays unused. */
    checkUser: (code: string) => askWithCode("/user/check", { code }, deviceUserPreviewSchema),

    /** Changes this device's user with a code from the hub; its token and everything else stay. */
    async changeUser(code: string, projects: DeviceUserChange["projects"]) {
      const result = await askWithCode("/user", { code, projects }, deviceUserResultSchema);
      userName = result.userName;
      log(`now acts as ${result.userName}`);
      return result;
    },

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
