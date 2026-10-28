import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { PlateState } from "@3d-maker-suite/core";

export type Fingerprint = { fileSize: number; fileMtimeMs: number; fileSha256: string };

/** Size, mtime and sha256 of a file; null when it can't be read. */
export async function fingerprint(abs: string): Promise<Fingerprint | null> {
  try {
    const s = await stat(abs);
    const hash = createHash("sha256");
    await pipeline(createReadStream(abs), hash);
    return { fileSize: s.size, fileMtimeMs: s.mtimeMs, fileSha256: hash.digest("hex") };
  } catch {
    return null;
  }
}

/**
 * Whether a device root's file, as its last scan lists it, is the one a fingerprint was taken of,
 * so it needn't be pulled. Its pulled copy carries the device's mtime, to within a millisecond.
 */
export const sameAsScanned = (
  file: { size: number; mtime?: number } | undefined,
  saved: Pick<Fingerprint, "fileSize" | "fileMtimeMs">,
) =>
  file?.mtime !== undefined &&
  file.size === saved.fileSize &&
  Math.abs(file.mtime - saved.fileMtimeMs) < 1;

/** Unchanged when size and mtime match; else only when the bytes still hash the same. */
export async function stateOf(abs: string, saved: Fingerprint): Promise<PlateState> {
  const s = await stat(abs).catch(() => null);
  if (!s) return "missing";
  if (s.size === saved.fileSize && s.mtimeMs === saved.fileMtimeMs) return "ok";
  // ponytail: re-hashes on every read once the mtime moved; store the new mtime if that gets slow.
  const now = await fingerprint(abs);
  return !now ? "missing" : now.fileSha256 === saved.fileSha256 ? "ok" : "outdated";
}
