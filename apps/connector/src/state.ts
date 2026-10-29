import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Blob, decrypt, encrypt, loadKey } from "@3d-maker-suite/host";

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
 * `cursor` is the last hub event handled (the stream's `Last-Event-ID`); `defaultSlicer` the id of
 * the slicer Open uses (slicers.ts); `folders` the real paths the hub may use (roots.ts), none yet
 * until the first roots fetch seeds them.
 */
type State = {
  hubUrl?: string;
  deviceId?: string;
  deviceName?: string;
  cursor?: number;
  defaultSlicer?: string;
  folders?: string[];
  /** An admin made this device a slice worker (`device.worker`): it runs the hub's slices. */
  sliceWorker?: boolean;
};
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
    /** Unpaired (revoked): keeps the hub URL and name to prefill the pair form. */
    forget: () => write({ hubUrl: saved.hubUrl, deviceName: saved.deviceName }),
  };
}

export type Store = ReturnType<typeof openStore>;
