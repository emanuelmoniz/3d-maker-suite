import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, sep } from "node:path";
import {
  type DesktopSlicer,
  PRESET_QUEUE_SHOWN,
  type PresetInstallItem,
  type PresetInstallSaved,
  type PresetInstallSlicer,
  SLICER_PRESET_KINDS,
  type SlicerPresetKind,
} from "@3d-maker-suite/core";
import { parsePreset, presetFileName, presetSha, presetText } from "./presets.ts";
import { isRunningIn } from "./processes.ts";
import { zipFolder } from "./zip.ts";

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

/** The account folder of the slicer whose config is `dir`; null = its `.conf` is being saved. */
export const readFolder = (dir: string, { config }: Pick<DesktopSlicer, "config">) =>
  readFile(join(dir, `${config}.conf`), "utf8").then(presetFolder, (e: NodeJS.ErrnoException) =>
    e.code === "ENOENT" ? "default" : null,
  );

/**
 * Writes the hub's user presets into one slicer's user folder (ADR-0017), while it's closed, with a
 * backup first; the connector and this server's own install both use it. Nothing is queued on disk:
 * what's waiting is the difference between the hub's lists and `installed`. A preset deleted on the
 * hub is deleted here, if this copy is the hub's (ADR-0019). Null = no folder to write to yet.
 */
export async function installPresets({
  slicer,
  dir,
  live,
  deleted,
  state,
  fetch,
  skip,
  skipped,
  alive,
  processes,
  backupFile,
  log,
  onRecord,
  onDelete,
}: {
  slicer: DesktopSlicer;
  /** The slicer's config folder. */
  dir: string;
  live: PresetInstallItem[];
  deleted: PresetInstallItem[];
  state: { get(): PresetInstallSaved; touch(): void; persist(): void };
  /** The hub's json of a preset. */
  fetch: (p: PresetInstallItem) => Promise<string>;
  /** Tells the hub a preset waits for a parent this slicer doesn't have. */
  skip: (p: PresetInstallItem) => Promise<void>;
  /** Reported as skipped, when their parent gets another look. */
  skipped: Set<string>;
  /** False = stop: the switch went off. */
  alive: () => boolean;
  processes: () => Promise<string>;
  /** Where the user folder is zipped before the first write of a batch. */
  backupFile: string;
  log: (line: string) => void;
  /** A file settled (`key`: library/folder/kind/path) or went. */
  onRecord?: (p: PresetInstallItem, key: string, mtimeMs: number) => void;
  onDelete?: (key: string) => void;
}): Promise<PresetInstallSlicer | null> {
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
  /** Settled: the caller knows the file came from the hub, so it has nothing to send back. */
  const record = async (p: PresetInstallItem, rel: string) => {
    const saved = state.get();
    saved.installed = { ...saved.installed, [keyOf(p)]: p.sha256 };
    onRecord?.(p, fileKey(p.kind, rel), (await stat(join(user, p.kind, rel))).mtimeMs);
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
      await zipFolder(join(dir, "user"), backupFile);
      const saved = state.get();
      saved.backups = {
        ...saved.backups,
        [slicer.id]: { path: backupFile, at: new Date().toISOString() },
      };
      state.touch();
      backedUp = true;
    };

    for (const p of [...deletes]) {
      if (!alive()) return null;
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
        onDelete?.(fileKey(p.kind, rel));
        existing.get(p.kind)?.delete(presetFileName(p.name));
        state.touch();
        deletes.splice(deletes.indexOf(p), 1);
        log(`preset ${p.name}: deleted in ${slicer.id}`);
      } catch (e) {
        log(`preset ${p.name}: ${message(e)}`); // still there: the next pass
      }
    }

    for (const p of mine.filter(due)) {
      if (!alive()) return null;
      try {
        const files = await filesOf(p.kind);
        const rel = relOf(p);
        const abs = join(user, p.kind, rel);
        const json = parsePreset(await fetch(p));
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
          await skip(p);
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
  return {
    library: slicer.library,
    folder: user,
    waiting: running && queue.length > 0,
    queued: queue.length,
    queue: queue.slice(0, PRESET_QUEUE_SHOWN).map(ref),
    backup: state.get().backups?.[slicer.id] ?? null,
    editsStayLocal: !slicer.uploadsDiskEdits && folder !== "default",
    deleteHere: canDelete ? [] : doomed.slice(0, PRESET_QUEUE_SHOWN).map(ref),
  };
}
