import { createHash } from "node:crypto";
import { type FSWatcher, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, sep } from "node:path";
import {
  type DesktopSlicer,
  presetUploadResultSchema,
  SLICER_PRESET_KINDS,
  type SlicerPresetKind,
} from "@3d-maker-suite/core";
import { parsePreset, presetSha } from "@3d-maker-suite/host";
import { QUIET_MS, type Request } from "./roots.ts";
import type { Store } from "./state.ts";

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
 * The account folder a slicer last used: `app.preset_folder` of its `.conf` (json, then a
 * `# MD5 checksum` line); empty or missing = `default`. Null = no json (it's being saved). Nothing
 * else of this file is used: it holds printers' access codes.
 */
export function presetFolder(conf: string) {
  try {
    const folder = JSON.parse(conf.replace(/^#.*$/gm, ""))?.app?.preset_folder;
    return typeof folder === "string" && folder ? folder : "default";
  } catch {
    return null;
  }
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
type Saved = { link: string; files: Record<string, Sent> };

/**
 * Share my presets (ADR-0017): the user preset folder of the account each found slicer last used
 * is watched, and a changed `.json` goes to the hub with its base version. `.info` files are never
 * looked at: Studio rewrites them on every start. Nothing is queued while offline: `<dataDir>/presets.json`
 * says what the hub has, so the next connect sends what changed. A deleted file only tells the hub.
 */
export function createPresetShare({
  request,
  store,
  dataDir,
  slicers,
  identity,
  log,
  configDir = configDirOf,
  pollMs = POLL_MS,
  settleMs = SETTLE_MS,
}: {
  request: Request;
  store: Store;
  dataDir: string;
  /** The found slicers, as the hub described them. */
  slicers: () => DesktopSlicer[];
  /** The hub URL and device id: a state file of another pairing starts over. */
  identity: () => string;
  log: (line: string) => void;
  /** Where a slicer's config is, and the timings (tests). */
  configDir?: (slicer: DesktopSlicer) => string;
  pollMs?: number;
  settleMs?: number;
}) {
  const file = join(dataDir, "presets.json");
  let saved: Saved | undefined;
  let changed = false;
  let on = false;
  let watchers: FSWatcher[] = [];
  let poll: NodeJS.Timeout | undefined;
  let quiet: NodeJS.Timeout | undefined;
  let looking: Promise<void> | undefined;
  let again = false;

  const state = () => {
    if (saved?.link === identity()) return saved;
    try {
      saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
    } catch {} // first start, or a damaged file: the hub answers by sha again
    if (saved?.link !== identity()) saved = { link: identity(), files: {} };
    return saved;
  };
  const persist = () => {
    if (!changed || !saved) return;
    writeFileSync(`${file}.tmp`, JSON.stringify(saved));
    renameSync(`${file}.tmp`, file);
    changed = false;
  };

  async function send(
    slicer: DesktopSlicer,
    kind: SlicerPresetKind,
    abs: string,
    key: string,
    fileName: string,
  ) {
    const files = state().files;
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
      changed = true;
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
    changed = true;
    if (result !== "same") log(`preset ${name}: ${result}`);
  }

  async function gone(slicer: DesktopSlicer, kind: SlicerPresetKind, entry: Sent) {
    const res = await request("/presets/removed", {
      method: "POST",
      body: { library: slicer.library, kind, name: entry.name },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entry.removed = true;
    changed = true;
  }

  async function lookAt(slicer: DesktopSlicer) {
    const dir = configDir(slicer);
    const folder = await readFile(join(dir, `${slicer.config}.conf`), "utf8").then(
      presetFolder,
      (e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? "default" : null),
    );
    if (folder === null) return;
    for (const kind of SLICER_PRESET_KINDS) {
      const base = join(dir, "user", folder, kind);
      const rels = await readdir(base, { recursive: true, encoding: "utf8" }).catch(() => null);
      // No folder says nothing about its presets: another account may not have this kind.
      if (!rels) continue;
      const prefix = `${slicer.library}/${folder}/${kind}/`;
      const here = new Set<string>();
      const attempt = (name: string, job: Promise<void>) =>
        job.catch((e) => log(`preset ${name}: ${e instanceof Error ? e.message : e}`));
      for (const rel of rels) {
        if (!on) return;
        if (!rel.endsWith(".json")) continue;
        const key = prefix + rel.split(sep).join("/");
        here.add(key);
        await attempt(rel, send(slicer, kind, join(base, rel), key, parse(rel).name));
      }
      for (const [key, entry] of Object.entries(state().files)) {
        if (!on) return;
        if (key.startsWith(prefix) && !here.has(key) && !entry.removed)
          await attempt(entry.name, gone(slicer, kind, entry));
      }
    }
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
        for (const slicer of slicers()) await lookAt(slicer);
        persist();
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
    /** Connected, or the switch changed: looks now and keeps watching, if the switch is on. */
    start() {
      stop();
      if (!store.get().sharePresets) return Promise.resolve();
      on = true;
      for (const slicer of slicers()) {
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
