import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions, REPO_URL } from "@3d-maker-suite/core";
import { fetchBundle } from "@3d-maker-suite/host";

/** Exit code that asks the launcher to start the newest version (RESTART in packaging/launcher.mjs). */
const RESTART = 75;
const OS: Record<string, string> = { win32: "windows", darwin: "macos", linux: "linux" };
const cmp = (a: string, b: string) => {
  try {
    return compareVersions(a, b);
  } catch {
    return 0; // not a version: leave it alone
  }
};

type Options = {
  version: string;
  env?: NodeJS.ProcessEnv;
  download?: typeof fetch;
  exit?: (code: number) => void;
  log?: (line: string) => void;
};

/**
 * The connector follows its hub's version, so the protocol always matches (ADR-0014). Installed
 * builds only: a newer hub → this platform's connector zip from that release (checked against
 * SHA256SUMS) into versions/<v>, pending.json for the launcher, exit RESTART. The launcher gives it
 * 60 s to answer /api/health, else goes back (rollback). No database, so no backup or undo.
 * APP_DOWNLOAD_URL: a stand-in for the release's download folder, to test against local builds.
 */
export function createUpdater({
  version,
  env = process.env,
  download = fetch,
  exit = (code) => process.exit(code),
  log = () => {},
}: Options) {
  const install = env.APP_INSTALL === "bundle" ? env.APP_INSTALL_DIR : undefined;
  // The launcher went back from this version once: don't try it again.
  let failed: string | undefined;
  try {
    const last = JSON.parse(readFileSync(join(install ?? "", ".update", "result.json"), "utf8"));
    if (!last.ok) failed = last.toVersion;
  } catch {} // no update yet
  let hubOlder = false;
  let error: string | undefined;

  return {
    state: () => ({ failed, hubOlder, error }),

    async follow(hub: string) {
      hubOlder = cmp(hub, version) < 0;
      if (!install || cmp(hub, version) <= 0 || hub === failed) return;
      const tag = `v${hub}`;
      const base = env.APP_DOWNLOAD_URL ?? `${REPO_URL}/releases/download/${tag}`;
      const asset = `3d-maker-suite-connector-${tag}-app-${OS[process.platform]}-${process.arch}.zip`;
      const partial = join(install, "versions", `${hub}.partial`);
      log(`updating to ${hub}`);
      try {
        await fetchBundle(base, asset, partial, download);
      } catch (e) {
        // Keeps the link up on this version and tries again at the next connect.
        error = (e as Error).message;
        return log(`update to ${hub} failed: ${error}`);
      }
      const dir = join(install, ".update");
      mkdirSync(dir, { recursive: true });
      const pending = { action: "update", toVersion: hub, from: version, fromVersion: version };
      writeFileSync(join(dir, "pending.json"), JSON.stringify(pending, null, 2));
      renameSync(partial, join(install, "versions", hub));
      exit(RESTART);
    },
  };
}

export type Updater = ReturnType<typeof createUpdater>;
