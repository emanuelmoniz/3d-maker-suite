import { readFile, stat } from "node:fs/promises";

/**
 * What a folder sits on (Plan 6.3.0 Step 5). `share`: a file system whose change events only come
 * for changes made through this machine's own mount (SMB, NFS, FUSE), so a folder there is kept
 * current by the scheduled rescan. `readOnly`: nothing can be written to it.
 */
export type MountInfo = { type: string | null; share: boolean; readOnly: boolean };

export const NO_MOUNT: MountInfo = { type: null, share: false, readOnly: false };

/** SMB, NFS and FUSE: a remote or user-space file system (the kernel names them like this). */
export const isShareType = (type: string) => /^(cifs|smb3|smbfs|nfs[34]?|fuse(\..+)?)$/.test(type);

type Entry = { point: string; type: string; readOnly: boolean };

/** `\040` and the like: mountinfo writes a space (or tab, newline, backslash) in octal. */
const fromOctal = (s: string) =>
  s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

/**
 * Parses `/proc/self/mountinfo`: `36 35 98:0 /root /mnt rw,noatime master:1 - ext3 /dev/root rw`.
 * The fields before ` - ` hold the mount point (5th) and its options (6th), the ones after the file
 * system type, its source and its own options.
 */
export function parseMountInfo(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    const [head, tail] = line.split(" - ");
    if (!head || !tail) continue;
    const a = head.split(" ");
    const b = tail.split(" ");
    const point = a[4];
    const type = b[0];
    if (!point || !type) continue;
    const ro = (opts?: string) => (opts ?? "").split(",").includes("ro");
    out.push({ point: fromOctal(point), type, readOnly: ro(a[5]) || ro(b[2]) });
  }
  return out;
}

/**
 * The mount `path` is on: the one with the longest mount point that holds it. Linux reads
 * `/proc/self/mountinfo` (`text` replaces it in tests); a UNC path (a Windows share, also a mapped
 * drive once its real path is taken) is a share; anywhere else nothing is known.
 */
export async function mountOf(path: string, text?: string): Promise<MountInfo> {
  if (/^\\\\/.test(path) && !/^\\\\[?.]\\[A-Za-z]:/.test(path))
    return { type: "smb", share: true, readOnly: false };
  const info = text ?? (await readFile("/proc/self/mountinfo", "utf8").catch(() => null));
  if (!info) return NO_MOUNT;
  let best: Entry | undefined;
  for (const e of parseMountInfo(info)) {
    const inside = e.point === "/" || path === e.point || path.startsWith(`${e.point}/`);
    if (inside && (!best || e.point.length >= best.point.length)) best = e;
  }
  return best
    ? { type: best.type, share: isShareType(best.type), readOnly: best.readOnly }
    : NO_MOUNT;
}

/**
 * Which folder a path is now: its device and inode, or null when it isn't there. A share dropped
 * and mounted again is another folder at the same path, and the watcher on the old one stays silent
 * with no error (Plan 6.3.0 Step 5), so a changed identity means "watch it again".
 */
export async function folderIdent(path: string): Promise<string | null> {
  const s = await stat(path).catch(() => null);
  return s?.isDirectory() ? `${s.dev}:${s.ino}` : null;
}
