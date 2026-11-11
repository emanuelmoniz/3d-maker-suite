import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, sep } from "node:path";
import {
  type DesktopSlicer,
  PRESET_QUEUE_SHOWN,
  type PresetInstallItem,
  type PresetInstallSlicer,
  presetInstallItemSchema,
  SLICER_PRESET_KINDS,
  type SlicerPresetKind,
} from "@3d-maker-suite/core";
import {
  isRunningIn,
  listProcesses,
  parsePreset,
  presetFileName,
  presetSha,
  presetText,
  zipFolder,
} from "@3d-maker-suite/host";
import { z } from "zod";
import { configDirOf, type PresetState, readFolder } from "./presets.ts";
import type { Request } from "./roots.ts";
import { presetsOn, type Store } from "./state.ts";

/** The queue is looked at this often: a closed slicer or a hub change needs nothing sooner. */
const POLL_MS = 30_000;
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

async function writeAtomic(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

/**
 * Install hub presets (ADR-0017): the hub's presets go to the user preset folder of the account each
 * found slicer last used, while that slicer is closed. Nothing is queued on disk: what's waiting is
 * the difference between the hub's lists and `installed`, so a restart or a sign-in loses nothing.
 * A preset deleted on this desktop is written back unless the hub acts on that removal, and one
 * deleted on the hub is deleted here, if this copy is the hub's (ADR-0019).
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
  /** Runs at the start of each pass: what's unsent goes to the hub first (Share's look). */
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

  async function flush(
    slicer: DesktopSlicer,
    live: PresetInstallItem[],
    deleted: PresetInstallItem[],
  ) {
    const dir = configDir(slicer);
    // Each time: a sign-in moves it.
    const folder = await readFolder(dir, slicer);
    if (folder === null) return null;
    const user = join(dir, "user", folder);
    const keyOf = (p: PresetInstallItem) => `${slicer.library}/${folder}/${p.kind}/${p.name}`;
    const fileKey = (kind: SlicerPresetKind, rel: string) =>
      `${slicer.library}/${folder}/${kind}/${rel.split(sep).join("/")}`;
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
    for (const kind of SLICER_PRESET_KINDS) await filesOf(kind);
    const here = (p: PresetInstallItem) => existing.get(p.kind)?.get(presetFileName(p.name));
    // A missing file is written back (a non-owner's removal, ADR-0019) unless the hub acts on it.
    const due = (p: PresetInstallItem) =>
      !skipped.has(`${keyOf(p)}@${p.sha256}`) &&
      (here(p) ? state.get().installed?.[keyOf(p)] !== p.sha256 : !p.removedHere);
    const relOf = (p: PresetInstallItem) => here(p) ?? presetFileName(p.name);
    const readDisk = async (p: PresetInstallItem, rel: string) => {
      const disk = parsePreset(await readFile(join(user, p.kind, rel), "utf8").catch(() => ""));
      return disk && presetSha(disk);
    };
    /** Settled. Share knows the file came from the hub, so it has nothing to send back. */
    const record = async (p: PresetInstallItem, rel: string) => {
      const saved = state.get();
      saved.installed = { ...saved.installed, [keyOf(p)]: p.sha256 };
      const key = fileKey(p.kind, rel);
      saved.files[key] = {
        ...saved.files[key],
        name: p.name,
        sha: p.sha256,
        base: p.version,
        mtimeMs: (await stat(join(user, p.kind, rel))).mtimeMs,
      };
      existing.get(p.kind)?.set(presetFileName(p.name), rel);
      state.touch();
    };

    // The same content needs no write, so no closed slicer either.
    for (const p of mine.filter(due)) {
      const rel = relOf(p);
      if ((await readDisk(p, rel)) === p.sha256) await record(p, rel);
    }

    // Deleted on the hub: only a copy as the hub had it goes. Another content is an edit, which
    // wins: Share sends it and the hub has it again. A signed-in account whose cloud ignores a
    // tombstone needs a person in the slicer (ADR-0019).
    const doomed: PresetInstallItem[] = [];
    for (const p of deleted.filter((d) => d.library === slicer.library && here(d))) {
      const rel = here(p);
      if (rel && (await readDisk(p, rel)) === p.sha256) doomed.push(p);
    }
    const canDelete = folder === "default" || slicer.tombstones;
    const deletes = canDelete ? doomed : [];

    const work = mine.some(due) || deletes.length > 0;
    const running = work && isRunningIn(await processes(), slicer.process);
    if (work && !running) {
      let system: Promise<System | null> | undefined;
      let backedUp = false;
      const readInfo = (abs: string) =>
        readFile(abs.replace(/\.json$/, ".info"), "utf8").then(parseInfo, () => null);
      const backup = async () => {
        if (backedUp) return;
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
      };

      for (const p of [...deletes]) {
        if (!on) return null;
        try {
          const rel = here(p);
          if (!rel) continue;
          const abs = join(user, p.kind, rel);
          await backup();
          // `.info` first, as for a write: the cloud deletes its copy at the slicer's next start.
          const info = folder === "default" ? null : await readInfo(abs);
          if (info)
            await writeAtomic(
              abs.replace(/\.json$/, ".info"),
              infoText({ ...info, sync_info: "delete" }),
            );
          else await rm(abs.replace(/\.json$/, ".info"), { force: true });
          await rm(abs, { force: true });
          const saved = state.get();
          if (saved.installed) delete saved.installed[keyOf(p)];
          delete saved.files[fileKey(p.kind, rel)];
          existing.get(p.kind)?.delete(presetFileName(p.name));
          state.touch();
          deletes.splice(deletes.indexOf(p), 1);
          log(`preset ${p.name}: deleted in ${slicer.id}`);
        } catch (e) {
          log(`preset ${p.name}: ${message(e)}`); // still there: the next pass
        }
      }

      for (const p of mine.filter(due)) {
        if (!on) return null;
        try {
          const files = await filesOf(p.kind);
          const rel = relOf(p);
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

          await backup();
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

    const queue = [...mine.filter(due), ...deletes];
    const ref = ({ library, kind, name }: PresetInstallItem) => ({ library, kind, name });
    const status: PresetInstallSlicer = {
      library: slicer.library,
      folder: user,
      waiting: running && queue.length > 0,
      queued: queue.length,
      queue: queue.slice(0, PRESET_QUEUE_SHOWN).map(ref),
      backup: state.get().backups?.[slicer.id] ?? null,
      editsStayLocal: !slicer.uploadsDiskEdits && folder !== "default",
      deleteHere: canDelete ? [] : doomed.slice(0, PRESET_QUEUE_SHOWN).map(ref),
    };
    return status;
  }

  /** One pass at a time; the next poll takes what's new. Resolves when it's done. */
  function pass(): Promise<void> {
    passing ??= (async () => {
      // What's unsent goes to the hub first: an edit isn't lost, and a removal it just heard of
      // isn't written back from a list read before it (`removedHere`).
      await beforeWrite();
      const list = async (path: string) => {
        const res = await request(path);
        if (res.status === 403) return null; // the switch just went off
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return z.array(presetInstallItemSchema).parse(await res.json());
      };
      const live = await list("/presets");
      const deleted = live && (await list("/presets/deleted"));
      if (!live || !deleted) return;
      const status: PresetInstallSlicer[] = [];
      // Only the slicers Install is on for (ADR-0020); the hub lists only their libraries.
      for (const slicer of slicers().filter((s) => presetsOn(store.get(), "install", s.library))) {
        if (!on) return;
        const one = await flush(slicer, live, deleted);
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
    /** A pass now, if a switch is on (tests). */
    pass: () => (on ? pass() : Promise.resolve()),
    /** Connected, or a switch changed: looks now and keeps looking, if one is on. */
    start() {
      stop();
      if (!presetsOn(store.get(), "install")) return Promise.resolve();
      on = true;
      lastReport = "";
      skipped.clear();
      poll = setInterval(() => void pass(), pollMs);
      poll.unref();
      return pass();
    },
  };
}
