import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SharedFolder } from "@3d-maker-suite/core";
import { type Blob, decrypt, encrypt, loadKey } from "@3d-maker-suite/host";

/** The hub's product id, which names its data folder next to the connector's. */
const HUB_ID = "3d-maker-suite";

/** Names the installer, the launcher (product.json) and start at login use for the connector. */
export const PRODUCT = {
  id: "3d-maker-suite-connector",
  name: "3D Maker Suite Connector",
  label: "com.3dmakersuite.connector.login",
};
export const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
/** Outside Desktop, Documents and Downloads, which macOS guards with a consent prompt (ADR-0014). */
export const syncDir = (home = homedir()) => join(home, "3D Maker Suite");

/** Same as dataDir() in packaging/launcher.mjs with the connector's id. */
export function dataDir(env = process.env, platform = process.platform): string {
  if (env.APP_DATA_DIR) return env.APP_DATA_DIR;
  const home = homedir();
  if (platform === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), PRODUCT.id);
  if (platform === "darwin") return join(home, "Library", "Application Support", PRODUCT.id);
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), PRODUCT.id);
}

/** The status page's port: `config.json` `{ "port": n }`, else 4301 (the launcher reads it too). */
export function readPort(dir: string): number {
  try {
    const port = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).port;
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  } catch {}
  return 4301;
}

/**
 * The version of a hub answering on this machine's hub port (the hub's `config.json` port, else 4300),
 * or undefined. One hub per machine: the connector doesn't start beside it (ADR-0014).
 */
export async function localHub(
  ownPort: number,
  { env = process.env, platform = process.platform, fetcher = fetch } = {},
): Promise<string | undefined> {
  let port = 4300;
  try {
    const hubDir = join(dirname(dataDir({ ...env, APP_DATA_DIR: undefined }, platform)), HUB_ID);
    const saved = JSON.parse(readFileSync(join(hubDir, "config.json"), "utf8")).port;
    if (Number.isInteger(saved) && saved > 0 && saved < 65536) port = saved;
  } catch {}
  if (port === ownPort) return undefined;
  try {
    const res = await fetcher(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = await res.json();
    return res.ok && body?.status === "ok" && typeof body.version === "string"
      ? body.version
      : undefined;
  } catch {
    return undefined;
  }
}

/** Start at login is on unless `config.json` says `"autostart": false` (Edit connector page). */
export function readAutostart(dir: string): boolean {
  try {
    return JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).autostart !== false;
  } catch {
    return true;
  }
}

/** Merges into `config.json`, which the launcher reads for the port too. */
export function writeConfig(dir: string, patch: { port?: number; autostart?: boolean }) {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  } catch {}
  const file = join(dir, "config.json");
  writeFileSync(`${file}.tmp`, JSON.stringify({ ...config, ...patch }, null, 2));
  renameSync(`${file}.tmp`, file);
}

/**
 * `cursor` is the last hub event handled (the stream's `Last-Event-ID`); `defaultSlicer` the id of
 * the slicer Open uses (slicers.ts); `sharedFolders` the folders the hub may use, as the hub keeps
 * them (roots.ts, ADR-0021).
 */
type State = {
  hubUrl?: string;
  deviceId?: string;
  deviceName?: string;
  cursor?: number;
  defaultSlicer?: string;
  sharedFolders?: SharedFolder[];
  /** Before 5.5.0 it kept the list itself: sent to the hub once, then dropped. */
  folders?: string[];
  /** Share to the hub (`projects.share`, `X-Share-Projects`); false = none of its folders is shared. */
  shareProjects?: boolean;
  /** An admin made this device a slice worker (`device.worker`): it runs the hub's slices. */
  sliceWorker?: boolean;
  /**
   * Per slicer library (`presets.set`, `X-Preset-Libraries`): Send presets (its user presets go to
   * the hub) and Install (the hub's presets go to that slicer).
   */
  presetLibraries?: Record<string, { send: boolean; install: boolean }>;
};

/** A switch is on for `library`, or for any library. */
export const presetsOn = (s: State, key: "send" | "install", library?: string) =>
  library
    ? !!s.presetLibraries?.[library]?.[key]
    : Object.values(s.presetLibraries ?? {}).some((l) => l[key]);
type Saved = State & { token?: Blob };

/**
 * `<dir>/state.json`, written whole and renamed. The device token is encrypted with `secret.key`
 * (as the server keeps integration tokens) and only `token()` reads it.
 */
export function openStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "state.json");
  const key = loadKey(dir);
  let saved: Saved = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {} // first start, or a damaged file: not paired
  const write = (next: Saved) => {
    saved = next;
    writeFileSync(`${file}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  return {
    get: (): State => {
      const { token: _, ...state } = saved;
      return state;
    },
    /** Undefined when not paired, or when `secret.key` no longer matches. */
    token: (): string | undefined => {
      try {
        return saved.token && decrypt(key, saved.token).token;
      } catch {
        return undefined;
      }
    },
    set: ({ token, ...patch }: State & { token?: string }) =>
      write({ ...saved, ...patch, ...(token !== undefined && { token: encrypt(key, { token }) }) }),
    /** Unpaired (revoked, or by the user): drops the token and all state, keeps the hub URL and name to prefill the pair form. */
    forget: () => write({ hubUrl: saved.hubUrl, deviceName: saved.deviceName }),
  };
}

export type Store = ReturnType<typeof openStore>;
