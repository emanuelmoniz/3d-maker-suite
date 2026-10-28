import { readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

// Kept free of workspace imports: apps/web/vite.config.ts loads this file directly.
const portSchema = {
  safeParse: (n: unknown) =>
    Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 65535
      ? { success: true as const, data: n as number }
      : { success: false as const, data: undefined },
};

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

const HOST_NAME =
  /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$|^\[[0-9a-f:.]+\]$/;

/** `APP_ALLOWED_HOSTS`: bare host names or IPs only (IPv6 in brackets), so no pattern can widen the guard. */
function parseAllowedHosts(value: string | undefined): string[] {
  const hosts = (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  for (const h of hosts)
    if (!HOST_NAME.test(h))
      throw new Error(
        `Invalid APP_ALLOWED_HOSTS entry: "${h}" (use a bare host name or IP: no scheme, port, path or wildcard; IPv6 in brackets)`,
      );
  return [...new Set(hosts)];
}

/**
 * `APP_TRUST_PROXY`: the reverse proxies' IPs/CIDRs (`127.0.0.1`, `172.16.0.0/12`). Then `req.ip`
 * is the client from `X-Forwarded-For`, so the per-IP login and pairing limits count each client.
 * Addresses only: trusting any (`true`) or a hop count would let a client name its own IP in the
 * header when the proxies change.
 */
function parseTrustProxy(value: string | undefined): string[] | undefined {
  const list = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of list) {
    const [ip = "", bits, ...rest] = s.split("/");
    const max = isIP(ip) === 4 ? 32 : 128;
    if (!isIP(ip) || rest.length || (bits !== undefined && !(/^\d+$/.test(bits) && +bits <= max)))
      throw new Error(
        `Invalid APP_TRUST_PROXY entry: "${s}" (use the proxies' IPs or CIDRs, e.g. 127.0.0.1,172.16.0.0/12)`,
      );
  }
  return list.length ? list : undefined;
}

/** Precedence per setting: CLI flag > env > config file > default. */
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4300;

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
  const [host, hostSource] = pick(flags.host, env.HOST, saved.host, DEFAULT_HOST, (v) => v);
  const [port, portSource] = pick(flags.port, env.PORT, saved.port, DEFAULT_PORT, parsePort);

  return {
    host,
    port,
    hostSource,
    portSource,
    dataDir: dir,
    /** Required to reach the app from other devices (HTTP Basic auth, any user name). */
    password: env.APP_PASSWORD || undefined,
    /** Public host names a reverse proxy forwards in `Host`; env only (a deployment decision). */
    allowedHosts: parseAllowedHosts(env.APP_ALLOWED_HOSTS),
    /** Proxies whose `X-Forwarded-For` names the client; env only, like `allowedHosts`. */
    trustProxy: parseTrustProxy(env.APP_TRUST_PROXY),
    /** Registers the fake adapter so the Integrations page can be tried without a vendor account. */
    mockIntegration: env.APP_MOCK_INTEGRATION === "1",
  };
}

export type Config = ReturnType<typeof loadConfig>;
