import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  type DesktopSlicer,
  PRESET_QUEUE_SHOWN,
  type PresetInstallItem,
  type PresetInstallSlicer,
  presetInstallItemSchema,
  SLICER_PRESET_KINDS,
  type SlicerPresetKind,
} from "@3d-maker-suite/core";
import { parsePreset, presetFileName, presetSha, presetText } from "@3d-maker-suite/host";
import yazl from "yazl";
import { z } from "zod";
import { configDirOf, type PresetState, readFolder } from "./presets.ts";
import type { Request } from "./roots.ts";
import type { Store } from "./state.ts";

/** The queue is looked at this often: a closed slicer or a hub change needs nothing sooner. */
const POLL_MS = 30_000;
const exec = promisify(execFile);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A preset's `.info` (ADR-0017): five `key = value` lines, LF on every OS. */
export type PresetInfo = {
  sync_info: string;
  user_id: string;
  setting_id: string;
  base_id: string;
  updated_time: number;
};

export function parseInfo(text: string): PresetInfo {
  const v = new Map(
    text.split(/\r?\n/).flatMap((l) => {
      const m = /^(\w+) = ?(.*)$/.exec(l);
      return m ? [[m[1], m[2]?.trim() ?? ""] as const] : [];
    }),
  );
  return {
    sync_info: v.get("sync_info") ?? "",
    user_id: v.get("user_id") ?? "",
    setting_id: v.get("setting_id") ?? "",
    base_id: v.get("base_id") ?? "",
    updated_time: Number(v.get("updated_time")) || 0,
  };
}

export const infoText = (i: PresetInfo) =>
  `sync_info = ${i.sync_info}\nuser_id = ${i.user_id}\nsetting_id = ${i.setting_id}\nbase_id = ${i.base_id}\nupdated_time = ${i.updated_time}\n`;

/**
 * The `.info` after a write. A `setting_id` means a cloud copy: `update`, never `create` (Orca would
 * replace the file at start). An `update` must look newer than the cloud's copy, or the slicer takes
 * that one instead. The old value isn't enough: right after a `create` it's behind the cloud's time
 * (Studio stores +7 h, its cloud +8 h), so `leadS` also puts it ahead of the cloud's clock. That lasts
 * until the upload at the slicer's next start, which sets the real value.
 */
export function nextInfo(
  old: PresetInfo | null,
  userId: string,
  baseId: string,
  now: number,
  leadS = 0,
): PresetInfo {
  const settingId = old?.setting_id ?? "";
  return {
    sync_info: settingId ? "update" : "create",
    user_id: userId,
    setting_id: settingId,
    base_id: old?.base_id || baseId,
    updated_time: Math.max((old?.updated_time ?? 0) + 1, settingId ? now + leadS : now),
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.exe$/, "")
    .replace(/[-_ ]/g, "");

/** `tasklist /fo csv /nh` or `ps -A -o comm=`; no output = we can't tell = running. */
export function isRunningIn(out: string, name: string) {
  if (!out.trim()) return true;
  return out.split(/\r?\n/).some((l) => {
    const proc = l.startsWith('"')
      ? l.slice(1, l.indexOf('"', 1))
      : (l.trim().split("/").at(-1) ?? "");
    return norm(proc) === norm(name);
  });
}

/** Every process's name. The check-out lock's exit detection only knows the pids it started. */
export const listProcesses = (platform: string = process.platform) =>
  exec(
    platform === "win32" ? "tasklist" : "ps",
    platform === "win32" ? ["/fo", "csv", "/nh"] : ["-A", "-o", "comm="],
    { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  ).then(
    (r) => r.stdout,
    () => "",
  );

type System = Record<SlicerPresetKind, Map<string, string>>;

/**
 * A slicer's system presets per kind, name → `setting_id` (`system/<vendor>/<kind>/`). Null = none
 * readable: it hasn't started yet, or it's Orca ≥ 2.5, whose are binary `.opc` files (ADR-0013).
 */
export async function systemPresets(dir: string): Promise<System | null> {
  const root = join(dir, "system");
  const rels = await readdir(root, { recursive: true, encoding: "utf8" }).catch(() => []);
  const found: System = { machine: new Map(), process: new Map(), filament: new Map() };
  let any = false;
  for (const rel of rels) {
    const kind = rel.split(sep)[1] as SlicerPresetKind;
    if (!rel.endsWith(".json") || !SLICER_PRESET_KINDS.includes(kind)) continue;
    const json = parsePreset(await readFile(join(root, rel), "utf8").catch(() => ""));
    if (typeof json?.name !== "string") continue;
    found[kind].set(json.name, typeof json.setting_id === "string" ? json.setting_id : "");
    any = true;
  }
  return any ? found : null;
}

/** All of `dir` to a zip; the old one stays until the new one is complete. */
async function zipFolder(dir: string, file: string) {
  await mkdir(dirname(file), { recursive: true });
  const zip = new yazl.ZipFile();
  const failed = new Promise<never>((_, reject) => zip.on("error", reject));
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = join(e.parentPath, e.name);
    zip.addFile(abs, relative(dir, abs).split(sep).join("/"));
  }
  zip.end();
  await Promise.race([pipeline(zip.outputStream, createWriteStream(`${file}.tmp`)), failed]);
  await rename(`${file}.tmp`, file);
}

async function writeAtomic(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

/**
 * Install hub presets (ADR-0017): the hub's presets go to the user preset folder of the account each
 * found slicer last used, while that slicer is closed. Nothing is queued on disk: what's waiting is
 * the difference between the hub's list and `installed`, so a restart or a sign-in loses nothing,
 * and a preset deleted on this desktop stays away until the hub has a new version of it.
 */
export function createPresetInstall({
  request,
  store,
  state,
  slicers,
  dataDir,
  log,
  beforeWrite = async () => {},
  configDir = configDirOf,
  processes = listProcesses,
  pollMs = POLL_MS,
}: {
  request: Request;
  store: Store;
  state: PresetState;
  /** The found slicers, as the hub described them. */
  slicers: () => DesktopSlicer[];
  dataDir: string;
  log: (line: string) => void;
  /** Runs before a batch of writes: what's unsent goes to the hub first, so an edit isn't lost. */
  beforeWrite?: () => Promise<void>;
  /** Where a slicer's config is, the process list and the timing (tests). */
  configDir?: (slicer: DesktopSlicer) => string;
  processes?: () => Promise<string>;
  pollMs?: number;
}) {
  let on = false;
  let poll: NodeJS.Timeout | undefined;
  let passing: Promise<void> | undefined;
  let lastReport = "";
  /** Reported as skipped since the last connect, when their parent gets another look. */
  const skipped = new Set<string>();

  async function flush(slicer: DesktopSlicer, live: PresetInstallItem[]) {
    const dir = configDir(slicer);
    // Each time: a sign-in moves it.
    const folder = await readFolder(dir, slicer);
    if (folder === null) return null;
    const user = join(dir, "user", folder);
    const keyOf = (p: PresetInstallItem) => `${slicer.library}/${folder}/${p.kind}/${p.name}`;
    const due = (p: PresetInstallItem) =>
      state.get().installed?.[keyOf(p)] !== p.sha256 && !skipped.has(`${keyOf(p)}@${p.sha256}`);
    const mine = live.filter((p) => p.library === slicer.library);

    // An existing file keeps its path (`filament/base/...`).
    const existing = new Map<string, Map<string, string>>();
    const filesOf = async (kind: SlicerPresetKind) => {
      let files = existing.get(kind);
      if (!files) {
        const rels = await readdir(join(user, kind), { recursive: true, encoding: "utf8" }).catch(
          () => [],
        );
        files = new Map(rels.filter((r) => r.endsWith(".json")).map((r) => [parse(r).base, r]));
        existing.set(kind, files);
      }
      return files;
    };
    const relOf = async (p: PresetInstallItem) =>
      (await filesOf(p.kind)).get(presetFileName(p.name)) ?? presetFileName(p.name);
    /** Settled. Share knows the file came from the hub, so it has nothing to send back. */
    const record = async (p: PresetInstallItem, rel: string) => {
      const saved = state.get();
      saved.installed = { ...saved.installed, [keyOf(p)]: p.sha256 };
      const key = `${slicer.library}/${folder}/${p.kind}/${rel.split(sep).join("/")}`;
      saved.files[key] = {
        ...saved.files[key],
        name: p.name,
        sha: p.sha256,
        base: p.version,
        mtimeMs: (await stat(join(user, p.kind, rel))).mtimeMs,
      };
      state.touch();
    };

    // The same content needs no write, so no closed slicer either.
    for (const p of mine.filter(due)) {
      const rel = await relOf(p);
      const disk = parsePreset(await readFile(join(user, p.kind, rel), "utf8").catch(() => ""));
      if (disk && presetSha(disk) === p.sha256) await record(p, rel);
    }

    const running = mine.some(due) && isRunningIn(await processes(), slicer.process);
    if (mine.some(due) && !running) {
      await beforeWrite();
      let system: Promise<System | null> | undefined;
      let backedUp = false;
      const readInfo = (abs: string) =>
        readFile(abs.replace(/\.json$/, ".info"), "utf8").then(parseInfo, () => null);

      for (const p of mine.filter(due)) {
        if (!on) return null;
        try {
          const files = await filesOf(p.kind);
          const rel = await relOf(p);
          const abs = join(user, p.kind, rel);
          const res = await request(`/presets/${p.id}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = parsePreset(await res.text());
          if (!json) throw new Error("not json");
          // It changed since the list (Share's look may have just sent it): the next look.
          if (presetSha(json) !== p.sha256) continue;

          system ??= systemPresets(dir);
          const known = await system;
          const parent = typeof json.inherits === "string" ? json.inherits : "";
          if (
            parent &&
            known &&
            !known[p.kind].has(parent) &&
            !files.has(presetFileName(parent)) &&
            !mine.some((m) => m.kind === p.kind && m.name === parent)
          ) {
            const res = await request("/presets/skipped", {
              method: "POST",
              body: { library: p.library, kind: p.kind, name: p.name, sha256: p.sha256 },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            skipped.add(`${keyOf(p)}@${p.sha256}`);
            log(`preset ${p.name}: skipped, no ${parent} here`);
            continue;
          }

          if (!backedUp) {
            // ponytail: only the last batch's backup is kept (ADR-0017); keep more if one isn't enough.
            const path = join(dataDir, "preset-backups", `${slicer.id}.zip`);
            await zipFolder(join(dir, "user"), path);
            const saved = state.get();
            saved.backups = {
              ...saved.backups,
              [slicer.id]: { path, at: new Date().toISOString() },
            };
            state.touch();
            backedUp = true;
          }
          // `.info` first: a failure in between leaves the json to write again. The other way round,
          // the next look would see the right json and never mark the edit for upload.
          if (folder !== "default") {
            // The first system preset up the chain: its own, or what a user parent has.
            const parentRel = files.get(presetFileName(parent));
            const baseId =
              known?.[p.kind].get(parent) ||
              (parentRel && (await readInfo(join(user, p.kind, parentRel)))?.base_id) ||
              "";
            const next = nextInfo(
              await readInfo(abs),
              folder,
              baseId,
              Math.floor(Date.now() / 1000),
              slicer.cloudClockLeadS,
            );
            await writeAtomic(abs.replace(/\.json$/, ".info"), infoText(next));
          }
          await writeAtomic(abs, presetText(json, slicer.presetIndent));
          await record(p, rel);
          log(`preset ${p.name}: installed in ${slicer.id}`);
        } catch (e) {
          log(`preset ${p.name}: ${message(e)}`); // not recorded: it's still due
        }
      }
    }
    state.persist();

    const queue = mine.filter(due);
    const status: PresetInstallSlicer = {
      library: slicer.library,
      folder: user,
      waiting: running && queue.length > 0,
      queued: queue.length,
      queue: queue.slice(0, PRESET_QUEUE_SHOWN).map(({ library, kind, name }) => ({
        library,
        kind,
        name,
      })),
      backup: state.get().backups?.[slicer.id] ?? null,
      editsStayLocal: !slicer.uploadsDiskEdits && folder !== "default",
    };
    return status;
  }

  /** One pass at a time; the next poll takes what's new. Resolves when it's done. */
  function pass(): Promise<void> {
    passing ??= (async () => {
      const res = await request("/presets");
      if (res.status === 403) return; // the switch just went off
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const live = z.array(presetInstallItemSchema).parse(await res.json());
      const status: PresetInstallSlicer[] = [];
      for (const slicer of slicers()) {
        if (!on) return;
        const one = await flush(slicer, live);
        if (one) status.push(one);
      }
      const text = JSON.stringify(status);
      if (!on || text === lastReport) return;
      const put = await request("/presets/install", { method: "PUT", body: status });
      if (put.ok) lastReport = text;
    })()
      .catch((e) => log(`presets: ${message(e)}`))
      .finally(() => {
        passing = undefined;
      });
    return passing;
  }

  function stop() {
    on = false;
    clearInterval(poll);
  }

  return {
    stop,
    /** A pass now, if the switch is on (tests). */
    pass: () => (on ? pass() : Promise.resolve()),
    /** Connected, or a switch changed: looks now and keeps looking, if the switch is on. */
    start() {
      stop();
      if (!store.get().installPresets) return Promise.resolve();
      on = true;
      lastReport = "";
      skipped.clear();
      poll = setInterval(() => void pass(), pollMs);
      poll.unref();
      return pass();
    },
  };
}
