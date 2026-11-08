import { createWriteStream, mkdirSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";

/**
 * All of `dir` to a zip, each entry under `prefix` (`"system/"`); the old one stays until the new
 * one is complete.
 */
export async function zipFolder(dir: string, file: string, prefix = "") {
  await mkdir(dirname(file), { recursive: true });
  const zip = new yazl.ZipFile();
  const failed = new Promise<never>((_, reject) => zip.on("error", reject));
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = join(e.parentPath, e.name);
    zip.addFile(abs, prefix + relative(dir, abs).split(sep).join("/"));
  }
  zip.end();
  await Promise.race([pipeline(zip.outputStream, createWriteStream(`${file}.tmp`)), failed]);
  await rename(`${file}.tmp`, file);
}

function openZip(file: string) {
  return new Promise<yauzl.ZipFile>((res, rej) =>
    yauzl.open(file, { lazyEntries: true }, (e, z) =>
      e || !z ? rej(e ?? new Error("bad zip")) : res(z),
    ),
  );
}

/**
 * Extracts the entries of a zip that `ok` lets through into `dest`. yauzl itself refuses absolute
 * and `..` entry names.
 */
export async function extract(file: string, dest: string, ok = (_entry: string) => true) {
  const zip = await openZip(file);
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (e: yauzl.Entry) => {
      const next = () => zip.readEntry();
      if (e.fileName.endsWith("/") || !ok(e.fileName)) return next();
      zip.openReadStream(e, async (err, stream) => {
        if (err || !stream) return reject(err);
        try {
          const out = join(dest, e.fileName);
          mkdirSync(dirname(out), { recursive: true });
          await pipeline(stream, createWriteStream(out));
          next();
        } catch (x) {
          reject(x);
        }
      });
    });
    zip.readEntry();
  });
}
