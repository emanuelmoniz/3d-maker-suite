import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** Runs a program and rejects on a non-zero exit; swapped for a fake in tests. */
export type Runner = (cmd: string, args: string[]) => Promise<unknown>;
const run: Runner = promisify(execFile);

export type Autostart = { get(): Promise<boolean>; set(enabled: boolean): Promise<void> };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A .desktop Exec argument in double quotes: backslash-escaped, and backslashes doubled again. */
const desktopArg = (s: string) =>
  `"${s.replace(/([\\"`$])/g, (c) => (c === "\\" ? "\\\\\\\\" : `\\${c}`))}"`;

/**
 * Start at login for the current user, no admin: Windows HKCU Run via reg.exe, macOS LaunchAgent,
 * Linux autostart .desktop. `cmd` is the full command line (APP_LAUNCH_CMD). `name` is also the Run
 * value the Windows installer writes (packaging/setup.iss) and `id` names the .desktop file; the
 * defaults are the app's, the connector passes its own. `home` and `exec` are test seams.
 */
export function createAutostart(
  cmd: string,
  {
    name = "3D Maker Suite",
    id = "3d-maker-suite",
    label = "com.3dmakersuite.login",
    platform = process.platform,
    home = homedir(),
    exec = run,
  } = {},
): Autostart {
  if (platform === "win32")
    return {
      get: () =>
        exec("reg", ["query", RUN_KEY, "/v", name]).then(
          () => true,
          () => false,
        ),
      set: async (on) => {
        if (on) await exec("reg", ["add", RUN_KEY, "/v", name, "/t", "REG_SZ", "/d", cmd, "/f"]);
        else if (await createAutostart(cmd, { name, platform, exec }).get())
          await exec("reg", ["delete", RUN_KEY, "/v", name, "/f"]);
      },
    };

  const mac = platform === "darwin";
  const file = mac
    ? join(home, "Library", "LaunchAgents", `${label}.plist`)
    : join(home, ".config", "autostart", `${id}.desktop`);
  const body = mac
    ? `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${xml(cmd)}</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`
    : `[Desktop Entry]
Type=Application
Name=${name}
Exec=/bin/sh -c ${desktopArg(cmd)}
Terminal=false
`;
  return {
    get: async () => existsSync(file),
    set: async (on) => {
      if (on) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, body);
      } else await rm(file, { force: true });
    },
  };
}
