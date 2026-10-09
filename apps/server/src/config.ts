import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export function dataDir(env: Env = process.env, platform = process.platform): string {
  if (env.APP_DATA_DIR) return env.APP_DATA_DIR;
  const home = homedir();
  if (platform === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "3d-maker-suite");
  if (platform === "darwin") return join(home, "Library", "Application Support", "3d-maker-suite");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "3d-maker-suite");
}

export function loadConfig(env: Env = process.env) {
  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 4300),
    dataDir: dataDir(env),
    /** Required to reach the app from other devices (HTTP Basic auth, any user name). */
    password: env.APP_PASSWORD || undefined,
    /** Registers the fake adapter so the Integrations page can be tried without a vendor account. */
    mockIntegration: env.APP_MOCK_INTEGRATION === "1",
  };
}
