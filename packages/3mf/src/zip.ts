import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";
import yauzl from "yauzl";

export type ThreeMfSource = string | Uint8Array;

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export interface Zip {
  has(name: string): boolean;
  /** Whole entry, or null if missing. Throws if larger than the safety cap. */
  read(name: string): Promise<Buffer | null>;
  /** Text from the start of an entry up to the chunk containing `marker`, then stops reading. */
  readHead(name: string, marker: string): Promise<string | null>;
  close(): void;
}

// Entry names are matched without a leading slash ("/3D/x.model" == "3D/x.model").
const norm = (name: string) => name.replace(/^\/+/, "");

/** Opens the zip and indexes the central directory only; entry data is read lazily on demand. */
export function openZip(source: ThreeMfSource): Promise<Zip> {
  return new Promise((resolve, reject) => {
    const done = (err: Error | null, zip?: yauzl.ZipFile) => {
      if (err || !zip) return reject(err ?? new Error("Not a zip file"));
      const entries = new Map<string, yauzl.Entry>();
      zip.on("entry", (e: yauzl.Entry) => {
        entries.set(norm(e.fileName), e);
        zip.readEntry();
      });
      zip.on("error", reject);
      zip.on("end", () => resolve(wrap(zip, entries)));
      zip.readEntry();
    };
    const opts = { lazyEntries: true, autoClose: false } as const;
    if (typeof source === "string") yauzl.open(source, opts, done);
    else yauzl.fromBuffer(Buffer.from(source), opts, done);
  });
}

function wrap(zip: yauzl.ZipFile, entries: Map<string, yauzl.Entry>): Zip {
  const stream = (name: string) =>
    new Promise<Readable | null>((resolve, reject) => {
      const entry = entries.get(norm(name));
      if (!entry) return resolve(null);
      zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s)));
    });

  return {
    has: (name) => entries.has(norm(name)),
    async read(name) {
      const entry = entries.get(norm(name));
      if (entry && entry.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`3MF entry too large: ${name}`);
      }
      const s = await stream(name);
      if (!s) return null;
      const chunks: Buffer[] = [];
      for await (const c of s) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    },
    async readHead(name, marker) {
      const s = await stream(name);
      if (!s) return null;
      let text = "";
      let found = false;
      // ponytail: drains the rest of the entry (discarded, so memory stays flat) because yauzl
      // crashes on early destroy(); costs inflate time for huge inline meshes, only worth
      // revisiting if a profile shows it.
      for await (const c of s) {
        if (!found) {
          text += (c as Buffer).toString("utf8");
          found = text.includes(marker);
        }
      }
      return text;
    },
    close: () => zip.close(),
  };
}
