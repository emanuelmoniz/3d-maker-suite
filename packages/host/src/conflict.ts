import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";

/** A file's sha256 (hex). */
export async function sha256Of(abs: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(abs), hash);
  return hash.digest("hex");
}

/** ` (conflict <who> <date>)`; `who` (a device or a user) made safe for a file name. */
export const conflictMark = (who: string, at: Date, n: number) => {
  const safe = who.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").replace(/[. ]+$/, "") || "device";
  const when = at.toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
  return ` (conflict ${safe} ${when}${n > 1 ? ` ${n}` : ""})`;
};

/** `<name> (conflict <who> <date>).<ext>`. */
export const conflictName = (name: string, who: string, at: Date, n: number) => {
  const ext = extname(name);
  return `${name.slice(0, name.length - ext.length)}${conflictMark(who, at, n)}${ext}`;
};
