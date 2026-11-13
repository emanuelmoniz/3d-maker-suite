import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DesktopSlicer, DeviceSlicer } from "@3d-maker-suite/core";

/**
 * A slicer found here, its product name (`windowsName`) and how to run it headless (`cli`:
 * `--help`, slicing on a worker).
 */
export type Found = DeviceSlicer & {
  name: string;
  cli: { cmd: string; args: string[] };
};
type Run = (cmd: string, args: string[]) => Promise<string>;

const exec = promisify(execFile);
const run: Run = (cmd, args) =>
  exec(cmd, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }).then(
    (r) => r.stdout,
    () => "",
  );
const UNINSTALL = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];

/** `reg query <key> /s`: the values of each subkey. */
export function parseReg(out: string) {
  const keys: Record<string, string>[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith("HKEY_")) keys.push({});
    const m = /^\s+(.+?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
    const key = keys.at(-1);
    if (m?.[1] && key) key[m[1]] = m[2] ?? "";
  }
  return keys;
}

/** `DisplayIcon`: the program, without quotes or an icon index (`"x.exe",0`). */
export const iconPath = (icon: string) => icon.replace(/,\s*-?\d+$/, "").replace(/^"(.*)"$/, "$1");

/** A key's string in an XML `Info.plist`. */
export const plistString = (xml: string, key: string) =>
  new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1] ?? null;
export const plistVersion = (xml: string) => plistString(xml, "CFBundleShortVersionString");

/** `flatpak list --app --columns=application,version`: version by app id. */
export const parseFlatpak = (out: string) =>
  new Map(
    out
      .split(/\r?\n/)
      .map((l) => l.split("\t"))
      .filter((c) => c[0])
      .map((c) => [c[0] ?? "", c[1]?.trim() || null]),
  );

const isFile = (p: string) =>
  stat(p).then(
    (s) => s.isFile(),
    () => false,
  );
const isDir = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );

/**
 * The installed slicers of `known` (ADR-0014): Windows `Uninstall` keys (HKLM, HKLM `WOW6432Node`,
 * HKCU) by exact `DisplayName`, macOS `/Applications/*.app`, Linux Flatpak. An AppImage or anything
 * else is a path the admin types for a slice worker (`check`).
 */
export async function findSlicers(
  known: DesktopSlicer[],
  platform: string = process.platform,
  exec: Run = run,
): Promise<Found[]> {
  const found: Found[] = [];
  if (platform === "win32") {
    const keys = (await Promise.all(UNINSTALL.map((k) => exec("reg", ["query", k, "/s"])))).flatMap(
      parseReg,
    );
    for (const k of known) {
      const key = keys.find((v) => v.DisplayName?.toLowerCase() === k.windowsName.toLowerCase());
      const path = key?.DisplayIcon && iconPath(key.DisplayIcon);
      if (path?.toLowerCase().endsWith(".exe") && (await isFile(path)))
        found.push({
          id: k.id,
          name: k.windowsName,
          version: key?.DisplayVersion || null,
          path,
          cli: { cmd: path, args: [] },
        });
    }
  } else if (platform === "darwin") {
    for (const k of known) {
      const path = join("/Applications", k.macApp);
      if (!(await isDir(path))) continue;
      const plist = await readFile(join(path, "Contents", "Info.plist"), "utf8").catch(() => "");
      // Headless, its program.
      const exe = plistString(plist, "CFBundleExecutable") ?? k.macApp.replace(/\.app$/, "");
      found.push({
        id: k.id,
        name: k.windowsName,
        version: plistVersion(plist),
        path,
        cli: { cmd: join(path, "Contents", "MacOS", exe), args: [] },
      });
    }
  } else {
    const apps = parseFlatpak(
      await exec("flatpak", ["list", "--app", "--columns=application,version"]),
    );
    for (const k of known)
      if (apps.has(k.flatpak))
        found.push({
          id: k.id,
          name: k.windowsName,
          version: apps.get(k.flatpak) ?? null,
          path: k.flatpak,
          cli: { cmd: "flatpak", args: ["run", k.flatpak] },
        });
  }
  return found;
}
