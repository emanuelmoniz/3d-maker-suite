import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, posix, relative } from "node:path";
import { parse3mf } from "@3d-maker-suite/3mf";
import type { ProjectFile, ProjectModel } from "@3d-maker-suite/core";

type Kind = ProjectFile["kind"];

const KINDS: Record<string, Kind> = {
  ".3mf": "model",
  ".stl": "model",
  ".step": "model",
  ".stp": "model",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".md": "doc",
  ".txt": "doc",
  ".pdf": "doc",
  ".url": "shortcut",
};
export const kindOf = (name: string): Kind | undefined => KINDS[extname(name).toLowerCase()];
export const isHidden = (name: string) => name.startsWith(".") || name === "node_modules";

// ponytail: fixed caps keep a stray huge folder from stalling a scan; make them settings if hit.
const MAX_DEPTH = 3; // folder levels below the project folder that are looked into
const MAX_FILES = 1000;
const MAX_3MF = 50; // only metadata is read (zip head + configs), so this stays cheap
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_DESCRIPTION = 2000;
const COVER_NAME = /^(cover|preview|thumbnail|thumb|main)\b/i;
const MARKETPLACE_URL =
  /https?:\/\/(?:www\.)?(?:makerworld\.com|printables\.com|thingiverse\.com)\/[^\s)<>"'\]]*/i;

export type Cover = { kind: "image"; abs: string } | { kind: "3mf"; abs: string; entry: string };

export interface FolderScan {
  files: ProjectFile[];
  models: ProjectModel[];
  description: string | null;
  sourceUrl: string | null;
  /** Absolute path of the main model file. */
  mainFile: string | null;
  cover: Cover | null;
  hasModel: boolean;
  /** 3MFs that could not be parsed (still listed as files). */
  unreadable: number;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const SLICED_EXPORT = /\.gcode\.3mf$/i;
const stem = (path: string) => path.replace(/(\.gcode)?\.3mf$/i, "").toLowerCase();

/**
 * A slicer's project save drops the slice results; its sliced export (`*.gcode.3mf`) has them.
 * Folds each export into the project 3MF of the same folder whose name starts the export's name
 * (`foo_plate_2.gcode.3mf` -> `foo.3mf`) and drops it from the list. An export without such a
 * file stays a model of its own.
 * ponytail: an export older than later edits to the project file is not detected; compare
 * modification times if stale numbers show up.
 */
export function mergeSlicedExports(models: ProjectModel[]): ProjectModel[] {
  const merged = new Set<ProjectModel>();
  for (const ex of models) {
    if (!SLICED_EXPORT.test(ex.file)) continue;
    const name = stem(ex.file);
    const target = models
      .filter((m) => {
        const own = stem(m.file);
        return (
          !SLICED_EXPORT.test(m.file) &&
          posix.dirname(m.file) === posix.dirname(ex.file) &&
          name.startsWith(own) &&
          !/^[\p{L}\p{N}]/u.test(name.slice(own.length))
        );
      })
      .sort((a, b) => b.file.length - a.file.length)[0];
    if (!target) continue;
    for (const sp of ex.plates) {
      const tp = sp.sliced && target.plates.find((p) => p.index === sp.index);
      if (!tp) continue;
      tp.sliced = true;
      tp.slicedOnSave = true;
      tp.printTimeSeconds = sp.printTimeSeconds;
      tp.weightGrams = sp.weightGrams;
      tp.filaments = sp.filaments;
      tp.multicolor = sp.multicolor;
    }
    target.sliced = target.plates.some((p) => p.sliced);
    target.multicolor = target.plates.some((p) => p.multicolor);
    merged.add(ex);
  }
  return models.filter((m) => !merged.has(m));
}

async function collect(root: string) {
  const out: (ProjectFile & { abs: string; mtimeMs: number })[] = [];
  async function walk(dir: string, level: number) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries.sort(byName)) {
      if (out.length >= MAX_FILES) return;
      if (isHidden(e.name)) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (level < MAX_DEPTH) await walk(abs, level + 1);
        continue;
      }
      const kind = e.isFile() ? kindOf(e.name) : undefined;
      if (!kind) continue;
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      const path = relative(root, abs).split("\\").join("/");
      out.push({ path, kind, size: st.size, abs, mtimeMs: st.mtimeMs });
    }
  }
  await walk(root, 0);
  return out;
}

async function readText(abs: string, size: number) {
  if (size > MAX_TEXT_BYTES) return "";
  return (await readFile(abs, "utf8").catch(() => "")).replace(/^\uFEFF/, "");
}

const tidyUrl = (u: string) => u.replace(/[.,;:!?]+$/, "");

/** Reads one project folder. Nothing is written; unreadable parts yield nulls, not errors. */
export async function scanFolder(dir: string): Promise<FolderScan> {
  const all = await collect(dir);
  const files = all.map(({ path, kind, size }) => ({ path, kind, size }));

  // Docs: README first, then other .md, then .txt. PDFs are listed but not read.
  const rank = (f: { path: string }) =>
    /(^|\/)readme[^/]*$/i.test(f.path) ? 0 : f.path.toLowerCase().endsWith(".md") ? 1 : 2;
  const docs = all
    .filter((f) => f.kind === "doc" && !f.path.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  const texts = await Promise.all(docs.map((d) => readText(d.abs, d.size)));

  let description: string | null = null;
  for (const t of texts) {
    // A leading "# Title" is the name, not the description.
    description =
      t
        .replace(/^(\s*#.*\n)+/, "")
        .trim()
        .slice(0, MAX_DESCRIPTION) || null;
    if (description) break;
  }

  // Marketplace link: .url shortcuts win over links mentioned in docs.
  const shortcuts = await Promise.all(
    all.filter((f) => f.kind === "shortcut").map((f) => readText(f.abs, f.size)),
  );
  const sourceUrl = [...shortcuts.map((s) => s.match(/^URL=(.+)$/im)?.[1]?.trim() ?? ""), ...texts]
    .map((t) => t.match(MARKETPLACE_URL)?.[0])
    .find(Boolean);

  const models: ProjectModel[] = [];
  // Over the cap, the newest files win (exports, not old drafts); folder order is kept.
  const newest = new Set(
    all
      .filter((f) => f.path.toLowerCase().endsWith(".3mf"))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_3MF),
  );
  const threeMfs = all.filter((f) => newest.has(f));
  const infos = new Map<string, Awaited<ReturnType<typeof parse3mf>>>();
  let unreadable = 0;
  for (const f of threeMfs) {
    try {
      const info = await parse3mf(f.abs);
      infos.set(f.path, info);
      models.push({ file: f.path, ...info });
    } catch {
      unreadable++;
    }
  }

  // ponytail: the newest 3MF is "the" project file; fall back to the first other model.
  // A sliced export is only the project file when there is nothing else.
  const modelFiles = all.filter((f) => f.kind === "model");
  const projectFiles = threeMfs.filter((f) => !SLICED_EXPORT.test(f.path));
  const main =
    [...(projectFiles.length ? projectFiles : threeMfs)].sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ??
    modelFiles[0] ??
    undefined;

  // Cover: a picture named like a cover, else the main 3MF's plate preview, else any picture.
  const images = all.filter((f) => f.kind === "image");
  const named = images.find((f) => COVER_NAME.test(f.path.split("/").pop() ?? ""));
  const plate = main && infos.get(main.path)?.plates.find((p) => p.thumbnail);
  const cover: Cover | null = named
    ? { kind: "image", abs: named.abs }
    : main && plate?.thumbnail
      ? { kind: "3mf", abs: main.abs, entry: plate.thumbnail }
      : images[0]
        ? { kind: "image", abs: images[0].abs }
        : null;

  return {
    files,
    models: mergeSlicedExports(models),
    description,
    sourceUrl: sourceUrl ? tidyUrl(sourceUrl) : null,
    mainFile: main?.abs ?? null,
    cover,
    hasModel: modelFiles.length > 0,
    unreadable,
  };
}
