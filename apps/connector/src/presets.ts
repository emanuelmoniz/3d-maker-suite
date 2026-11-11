import { createHash } from "node:crypto";
import { type FSWatcher, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, sep } from "node:path";
import {
  type DesktopSlicer,
  type PresetInstallSaved,
  presetRemovalResultSchema,
  presetUploadResultSchema,
  SLICER_PRESET_KINDS,
  type SlicerPresetKind,
} from "@3d-maker-suite/core";
import { parsePreset, presetSha, readFolder } from "@3d-maker-suite/host";
import { QUIET_MS, type Request } from "./roots.ts";
import { presetsOn, type Store } from "./state.ts";

/** Another look this often: a sign-in changes the folder, and a watch can miss events. */
const POLL_MS = 30_000;
/** Json that doesn't parse may still be being written: it's reported once it's this old. */
const SETTLE_MS = 10_000;

/** A slicer's config folder. Only a Flatpak is found on Linux (slicers.ts). */
export function configDirOf(
  { config, flatpak }: Pick<DesktopSlicer, "config" | "flatpak">,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
) {
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), config);
  if (platform === "darwin") return join(home, "Library", "Application Support", config);
  return join(home, ".var", "app", flatpak, "config", config);
}

/**
 * What the hub knows of a preset file. `sha`: the content last sent, never sent again. `base`: the
 * hub version it started from; a conflict leaves it, as the file still didn't start from the hub's.
 */
type Sent = {
  name: string;
  sha: string;
  base: number;
  mtimeMs: number;
  /** The file is gone, and the hub was told. */
  removed?: boolean;
};
/** `files`: what Share sent. `installed`: the sha Install last settled, per folder, kind and name. */
type Saved = PresetInstallSaved & { link: string; files: Record<string, Sent> };

/** `<dataDir>/presets.json`, which Share and Install keep together: a state of another pairing starts over. */
export function openPresetState(dataDir: string, identity: () => string) {
  const file = join(dataDir, "presets.json");
  let saved: Saved | undefined;
  let changed = false;
  return {
    get() {
      if (saved?.link === identity()) return saved;
      try {
        saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
      } catch {} // first start, or a damaged file: the hub answers by sha again
      if (saved?.link !== identity()) saved = { link: identity(), files: {} };
      return saved;
    },
    touch: () => {
      changed = true;
    },
    persist() {
      if (!changed || !saved) return;
      writeFileSync(`${file}.tmp`, JSON.stringify(saved));
      renameSync(`${file}.tmp`, file);
      changed = false;
    },
  };
}
export type PresetState = ReturnType<typeof openPresetState>;

/** At most this many removals per request; more at once is far over any mass delete limit. */
const REMOVALS_PER_REQUEST = 10_000;

/**
 * Share my presets (ADR-0017): the user preset folder of the account each found slicer last used
 * is watched, and a changed `.json` goes to the hub with its base version. `.info` files are never
 * looked at: Studio rewrites them on every start. Nothing is queued while offline: `<dataDir>/presets.json`
 * says what the hub has, so the next connect sends what changed. A look's deleted files go to the
 * hub together, which decides what they delete (ADR-0019); a file moved within its kind's folder
 * isn't one, and another account's folder (a sign-in or sign-out) is never compared.
 */
export function createPresetShare({
  request,
  store,
  state,
  slicers,
  log,
  configDir = configDirOf,
  pollMs = POLL_MS,
  settleMs = SETTLE_MS,
}: {
  request: Request;
  store: Store;
  state: PresetState;
  /** The found slicers, as the hub described them. */
  slicers: () => DesktopSlicer[];
  log: (line: string) => void;
  /** Where a slicer's config is, and the timings (tests). */
  configDir?: (slicer: DesktopSlicer) => string;
  pollMs?: number;
  settleMs?: number;
}) {
  let on = false;
  let watchers: FSWatcher[] = [];
  let poll: NodeJS.Timeout | undefined;
  let quiet: NodeJS.Timeout | undefined;
  let looking: Promise<void> | undefined;
  let again = false;
  /** The accounts last told to the hub, so an unchanged list isn't sent again. */
  let lastAccounts = "";
  /** The found slicers with Send presets on (ADR-0020). */
  const sending = () => slicers().filter((s) => presetsOn(store.get(), "send", s.library));

  async function send(
    slicer: DesktopSlicer,
    kind: SlicerPresetKind,
    abs: string,
    key: string,
    fileName: string,
  ) {
    const files = state.get().files;
    const was = files[key];
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile() || (was && !was.removed && was.mtimeMs === info.mtimeMs)) return;
    const text = await readFile(abs, "utf8").catch(() => null); // locked: the next look
    if (text === null) return;
    const json = parsePreset(text);
    if (!json && Date.now() - info.mtimeMs < settleMs) return;
    const sha = json ? presetSha(json) : createHash("sha256").update(text).digest("hex");
    if (was && !was.removed && was.sha === sha) {
      was.mtimeMs = info.mtimeMs;
      state.touch();
      return;
    }
    const res = await request("/presets", {
      method: "PUT",
      body: {
        library: slicer.library,
        kind,
        name: fileName,
        base: was?.base ?? 0,
        text,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { result, name, version } = presetUploadResultSchema.parse(await res.json());
    const onHub = result === "saved" || result === "same";
    files[key] = { name, sha, mtimeMs: info.mtimeMs, base: onHub ? version : (was?.base ?? 0) };
    state.touch();
    if (result !== "same") log(`preset ${name}: ${result}`);
  }

  /** One look's removals in one account folder, in one request each `REMOVALS_PER_REQUEST`. */
  async function gone(
    slicer: DesktopSlicer,
    account: string,
    entries: { kind: SlicerPresetKind; entry: Sent }[],
  ) {
    for (let i = 0; i < entries.length; i += REMOVALS_PER_REQUEST) {
      const part = entries.slice(i, i + REMOVALS_PER_REQUEST);
      const res = await request("/presets/removals", {
        method: "POST",
        body: {
          library: slicer.library,
          account,
          removed: part.map(({ kind, entry }) => ({ kind, name: entry.name })),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const r of presetRemovalResultSchema.parse(await res.json()))
        if (r.result !== "unknown") log(`preset ${r.name}: removed here, ${r.result} on the hub`);
      for (const { entry } of part) entry.removed = true;
      state.touch();
    }
  }

  /** Returns the account folder it looked at; null = none could be read. */
  async function lookAt(slicer: DesktopSlicer) {
    const dir = configDir(slicer);
    const folder = await readFolder(dir, slicer);
    if (folder === null) return null;
    const removed: { kind: SlicerPresetKind; entry: Sent }[] = [];
    const files = state.get().files;
    const attempt = (name: string, job: Promise<void>) =>
      job.catch((e) => log(`preset ${name}: ${e instanceof Error ? e.message : e}`));
    for (const kind of SLICER_PRESET_KINDS) {
      const base = join(dir, "user", folder, kind);
      const rels = await readdir(base, { recursive: true, encoding: "utf8" }).catch(() => null);
      // No folder says nothing about its presets: another account may not have this kind.
      if (!rels) continue;
      const prefix = `${slicer.library}/${folder}/${kind}/`;
      const here = new Set<string>();
      for (const rel of rels) {
        if (!on) return null;
        if (!rel.endsWith(".json")) continue;
        const key = prefix + rel.split(sep).join("/");
        here.add(key);
        await attempt(rel, send(slicer, kind, join(base, rel), key, parse(rel).name));
      }
      // A name still here at another path was moved (e.g. into `filament/base/`), not removed.
      const names = new Set(
        [...here].flatMap((k) => [parse(k).name, ...(files[k] ? [files[k].name] : [])]),
      );
      for (const [key, entry] of Object.entries(files)) {
        if (!key.startsWith(prefix) || here.has(key) || entry.removed) continue;
        if (names.has(entry.name)) {
          delete files[key];
          state.touch();
        } else removed.push({ kind, entry });
      }
    }
    if (removed.length && on) await attempt("removals", gone(slicer, folder, removed));
    return folder;
  }

  /** One look at a time; a change during one means another. Resolves when none is left. */
  function look(): Promise<void> {
    if (looking) {
      again = true;
      return looking;
    }
    looking = (async () => {
      do {
        again = false;
        const accounts: { library: string; account: string }[] = [];
        for (const slicer of sending()) {
          const account = await lookAt(slicer);
          if (account) accounts.push({ library: slicer.library, account });
        }
        state.persist();
        // Where each slicer shares from: the hub holds a removal another user's device may have
        // caused on a shared account (ADR-0019).
        const text = JSON.stringify(accounts);
        if (on && text !== lastAccounts) {
          const res = await request("/presets/share", { method: "PUT", body: accounts });
          if (res.ok) lastAccounts = text;
        }
      } while (again && on);
    })()
      .catch((e) => log(`presets: ${e instanceof Error ? e.message : e}`))
      .finally(() => {
        looking = undefined;
      });
    return looking;
  }

  function stop() {
    on = false;
    for (const w of watchers) w.close();
    watchers = [];
    clearInterval(poll);
    clearTimeout(quiet);
  }

  return {
    stop,
    /** A look now, if a switch is on: Install's writes come after what's unsent. */
    flush: () => (on ? look() : Promise.resolve()),
    /** Connected, or a switch changed: looks now and keeps watching the slicers it is on for. */
    start() {
      stop();
      if (!presetsOn(store.get(), "send")) return Promise.resolve();
      on = true;
      lastAccounts = "";
      for (const slicer of sending()) {
        const user = join(configDir(slicer), "user");
        try {
          const watcher = watch(user, { recursive: true }, (_, name) => {
            if (name && !name.endsWith(".json")) return;
            clearTimeout(quiet);
            quiet = setTimeout(() => void look(), QUIET_MS);
            quiet.unref();
          });
          watcher.on("error", (e) => log(`watch ${user}: ${e.message}`));
          watchers.push(watcher);
        } catch {} // no presets yet: the poll looks
      }
      poll = setInterval(() => void look(), pollMs);
      poll.unref();
      return look();
    },
  };
}
