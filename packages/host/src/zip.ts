import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

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
