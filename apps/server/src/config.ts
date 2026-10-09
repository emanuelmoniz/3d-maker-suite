import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { portSchema } from "@3d-maker-suite/core";

type Env = Record<string, string | undefined>;
export type Source = "cli" | "env" | "file" | "default";
export type SavedNet = { host?: string; port?: number };

export function dataDir(env: Env = process.env, platform = process.platform): string {
  if (env.APP_DATA_DIR) return env.APP_DATA_DIR;
  const home = homedir();
  if (platform === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "3d-maker-suite");
  if (platform === "darwin") return join(home, "Library", "Application Support", "3d-maker-suite");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "3d-maker-suite");
}

const configFile = (dir: string) => join(dir, "config.json");

/** Host/port saved from Settings. A missing or damaged file just means "nothing saved". */
export function readSavedConfig(dir: string): SavedNet {
  try {
    const raw = JSON.parse(readFileSync(configFile(dir), "utf8"));
    return {
      host: typeof raw.host === "string" && raw.host ? raw.host : undefined,
      port: portSchema.safeParse(raw.port).data,
    };
  } catch {
    return {};
  }
}

export function writeSavedConfig(dir: string, saved: SavedNet) {
  writeFileSync(configFile(dir), `${JSON.stringify(saved, null, 2)}\n`);
}

function parsePort(value: string, from: string): number {
  const port = portSchema.safeParse(Number(value));
  if (!port.success) throw new Error(`Invalid port from ${from}: "${value}" (use 1-65535)`);
  return port.data;
}

/** Precedence per setting: CLI flag > env > config file > default. */
export function loadConfig(env: Env = process.env, argv: string[] = process.argv.slice(2)) {
  const { values: flags } = parseArgs({
    args: argv,
    options: { host: { type: "string" }, port: { type: "string" } },
    strict: false, // pnpm/tsx may pass other args through
  });
  const dir = dataDir(env);
  const saved = readSavedConfig(dir);

  const pick = <T>(
    cli: unknown,
    envVal: string | undefined,
    file: T | undefined,
    fallback: T,
    parse: (v: string, from: string) => T,
  ): [T, Source] => {
    if (typeof cli === "string") return [parse(cli, "CLI flag"), "cli"];
    if (envVal) return [parse(envVal, "env"), "env"];
    if (file !== undefined) return [file, "file"];
    return [fallback, "default"];
  };
  const [host, hostSource] = pick(flags.host, env.HOST, saved.host, "127.0.0.1", (v) => v);
  const [port, portSource] = pick(flags.port, env.PORT, saved.port, 4300, parsePort);

  return {
    host,
    port,
    hostSource,
    portSource,
    dataDir: dir,
    /** Required to reach the app from other devices (HTTP Basic auth, any user name). */
    password: env.APP_PASSWORD || undefined,
    /** Registers the fake adapter so the Integrations page can be tried without a vendor account. */
    mockIntegration: env.APP_MOCK_INTEGRATION === "1",
  };
}

export type Config = ReturnType<typeof loadConfig>;
