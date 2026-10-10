import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { HttpError } from "../errors.ts";

// A zip of a slicer's config folder, unpacked so the local readers can read it like the real folder.
const MAX_ENTRIES = 60000; // OrcaSlicer's own system folder is ~12000 files
const MAX_BYTES = 500 * 1024 ** 2;
const KEEP = /\.(json|png)$/i; // all the readers use; logs, caches and plugins stay out
const DAY = 24 * 60 * 60 * 1000;

const bad = (code: string, message: string) => new HttpError(400, code, message);

/** Writes the json and png entries of `zip` under `dest`; nothing can land outside it. */
function extract(zip: Buffer, dest: string) {
  return new Promise<number>((done, fail) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, z) => {
      if (err || !z) return fail(bad("invalid_zip", "Couldn't read the zip"));
      const root = resolve(dest);
      let files = 0;
      let bytes = 0;
      z.on("error", () => fail(bad("invalid_zip", "Couldn't read the zip")));
      z.on("end", () => done(files));
      z.on("entry", (e: yauzl.Entry) => {
        const next = () => z.readEntry();
        if (e.fileName.endsWith("/") || !KEEP.test(e.fileName)) return next();
        bytes += e.uncompressedSize;
        if (++files > MAX_ENTRIES || bytes > MAX_BYTES) {
          z.close();
          return fail(bad("zip_too_large", "The zip holds too many or too large files"));
        }
        const out = resolve(root, e.fileName);
        if (!out.startsWith(root + sep)) return next();
        z.openReadStream(e, async (err2, stream) => {
          if (err2 || !stream) return fail(bad("invalid_zip", "Couldn't read the zip"));
          try {
            mkdirSync(dirname(out), { recursive: true });
            await pipeline(stream, createWriteStream(out));
            next();
          } catch {
            fail(bad("invalid_zip", "Couldn't read the zip"));
          }
        });
      });
      z.readEntry();
    });
  });
}

const hasLayout = (d: string) => existsSync(join(d, "system")) || existsSync(join(d, "user"));

/** The folder with `system`/`user` in it: the zip's top, or inside one wrapper folder ("OrcaSlicer/"). */
function configRoot(dir: string): string | null {
  if (hasLayout(dir)) return dir;
  for (const e of readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory() && hasLayout(join(dir, e.name))) return join(dir, e.name);
  return null;
}

/** Unpacks a zip into `<base>/<id>/files` and returns the config folder inside it. */
export async function unpackSlicerZip(base: string, id: string, source: string, zip: Buffer) {
  mkdirSync(base, { recursive: true });
  // Uploads nobody imported don't pile up.
  for (const f of readdirSync(base))
    if (Date.now() - statSync(join(base, f)).mtimeMs > DAY)
      rmSync(join(base, f), { recursive: true, force: true });
  const dir = join(base, id);
  const files = join(dir, "files");
  try {
    mkdirSync(files, { recursive: true });
    if (!(await extract(zip, files)) || !configRoot(files))
      throw bad("not_slicer_folder", "The zip isn't a slicer config folder");
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  // The source is the user's pick; it names the reader and the `sourcePreset` prefix.
  writeFileSync(join(dir, "source"), source);
}

/** An unpacked upload: the slicer it was made for and its config folder. */
export function openUpload(base: string, id: string) {
  const dir = join(base, id);
  const files = join(dir, "files");
  const root = existsSync(files) ? configRoot(files) : null;
  if (!root) throw new HttpError(404, "upload_not_found", "Upload not found; upload the zip again");
  return { root, source: readFileSync(join(dir, "source"), "utf8") };
}
