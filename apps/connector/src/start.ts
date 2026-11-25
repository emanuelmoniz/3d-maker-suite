// How the connector was started (ADR-0024): its install kind, and the hub and code to pair with
// when there is no screen to type them into. The launcher passes its arguments through.
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { ConnectorInstall } from "@3d-maker-suite/core";
import { HubAddressError, type Link, PairError } from "./hub.ts";
import { normalizeHubUrl } from "./hubUrls.ts";
import type { Store } from "./state.ts";

export type StartOptions = {
  /** Undefined from source (`pnpm start`): it reports none, and never updates itself. */
  install?: ConnectorInstall;
  /** No screen at the machine: no start at login (systemd or Docker start it), its user changes on the hub. */
  headless: boolean;
  /** `CONNECTOR_HUB_URL` (or `--hub-url`): a paired connector moves there when it changes. */
  hubUrl?: string;
  /** `CONNECTOR_HUB_URL` and `CONNECTOR_PAIRING_CODE` (or the flags), both set. */
  pair?: { hubUrl: string; code: string; name: string };
};

const on = (v: string | undefined) => !!v && !["0", "false", "no", "off"].includes(v.toLowerCase());

/**
 * `--hub-url`, `--pairing-code`, `--name` and `--headless`, else `CONNECTOR_HUB_URL`,
 * `CONNECTOR_PAIRING_CODE`, `CONNECTOR_NAME` and `CONNECTOR_HEADLESS`. `APP_INSTALL=docker` (the
 * image) is headless; `APP_INSTALL=bundle` (the launcher) is `bundle` unless headless.
 */
export function startOptions(
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): StartOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      "hub-url": { type: "string" },
      "pairing-code": { type: "string" },
      name: { type: "string" },
      headless: { type: "boolean" },
    },
    strict: false,
  });
  const str = (flag: unknown, variable: string | undefined) =>
    (typeof flag === "string" ? flag : variable)?.trim() || undefined;
  const docker = env.APP_INSTALL === "docker";
  const headless = docker || values.headless === true || on(env.CONNECTOR_HEADLESS);
  const install: ConnectorInstall | undefined = docker
    ? "docker"
    : headless
      ? "headless"
      : env.APP_INSTALL === "bundle"
        ? "bundle"
        : undefined;
  const hubUrl = str(values["hub-url"], env.CONNECTOR_HUB_URL);
  const code = str(values["pairing-code"], env.CONNECTOR_PAIRING_CODE);
  const name = str(values.name, env.CONNECTOR_NAME)?.slice(0, 100) ?? hostname().slice(0, 100);
  return {
    install,
    headless,
    ...(hubUrl && { hubUrl }),
    ...(hubUrl && code && { pair: { hubUrl, code, name } }),
  };
}

/** Any case, with or without the dash, as the hub reads a code. */
const fingerprint = (code: string) =>
  createHash("sha256")
    .update(code.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .digest("hex");
const KEEP = 50;

/**
 * `<dir>/pairing.json`: the hashes of the codes the hub refused or this connector paired with. A
 * code there is never sent again, across restarts and after a revoke, so a variable left in a
 * compose file can't knock on the hub at every start (ADR-0024, S2).
 */
export function openSpentCodes(dir: string) {
  const file = join(dir, "pairing.json");
  let spent: string[] = [];
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")).spent;
    if (Array.isArray(saved)) spent = saved.filter((s) => typeof s === "string");
  } catch {} // none yet
  return {
    has: (code: string) => spent.includes(fingerprint(code)),
    add(code: string) {
      const hash = fingerprint(code);
      if (spent.includes(hash)) return;
      spent = [...spent, hash].slice(-KEEP);
      writeFileSync(`${file}.tmp`, JSON.stringify({ spent }, null, 2), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
  };
}
export type SpentCodes = ReturnType<typeof openSpentCodes>;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    const t = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(t);
      done();
    };
    signal?.addEventListener("abort", stop, { once: true });
  });

const NEW_CODE =
  "make a new one in Hub management and set it in CONNECTOR_PAIRING_CODE (or --pairing-code)";

/**
 * Pairs with the code it was started with, once, if it isn't paired. A refused code ("wrong, used
 * or expired": the hub answers the same 401 for all three) is logged and remembered, and the
 * connector stays up unpaired: exiting loops under `restart: unless-stopped` and locks pairing out
 * for the whole address (S2). A hub that can't be reached yet (it starts after the NAS) is tried
 * again, `retryMs` doubling up to 5 minutes. Resolves when done, or when `signal` aborts.
 */
export async function pairAtStart({
  link,
  store,
  given,
  spent,
  log,
  retryMs = 5000,
  signal,
}: {
  link: Pick<Link, "pair">;
  store: Pick<Store, "token" | "set">;
  given: StartOptions["pair"];
  spent: SpentCodes;
  log: (line: string) => void;
  retryMs?: number;
  signal?: AbortSignal;
}) {
  if (!given || store.token()) return;
  if (spent.has(given.code))
    return log(`pairing: this code was refused or used before and isn't sent again; ${NEW_CODE}`);
  for (let delay = retryMs; !signal?.aborted; delay = Math.min(delay * 2, 5 * 60_000)) {
    if (store.token()) return; // paired on its own page meanwhile
    try {
      await link.pair(given.hubUrl, given.code, given.name);
      spent.add(given.code);
      store.set({ startedWith: normalizeHubUrl(given.hubUrl) });
      return;
    } catch (e) {
      if (!(e instanceof PairError)) throw e;
      if (e.code === "invalidCode") {
        spent.add(given.code);
        return log(`pairing: the hub refused the code (wrong, used or expired); ${NEW_CODE}`);
      }
      if (e.code === "badUrl")
        return log(`pairing: ${given.hubUrl} is not an http:// or https:// address`);
      // unreachable, hubOff, tooManyAttempts: none of them is the code's fault.
      log(`pairing: ${e.code} at ${given.hubUrl}, trying again in ${Math.round(delay / 1000)} s`);
      await sleep(delay, signal);
    }
  }
}

/**
 * A paired connector started with another hub address than last time (6.3.0 Step 7b): the hub
 * moved. It moves there once a hub there knows its token (the same hub, or one restored from its
 * backup), trying again while it can't be reached, `retryMs` doubling up to 5 minutes. A hub that
 * doesn't know it means pairing again: it unpairs, with that address kept, and `pairAtStart` pairs
 * with the code it was started with if that is a new one. An unchanged address does nothing, so a
 * compose file never undoes an address the hub announced since.
 */
export async function followHubAtStart({
  link,
  store,
  hubUrl,
  log,
  retryMs = 5000,
  signal,
}: {
  link: Pick<Link, "changeHub" | "unpair">;
  store: Pick<Store, "token" | "get" | "set">;
  hubUrl: string | undefined;
  log: (line: string) => void;
  retryMs?: number;
  signal?: AbortSignal;
}) {
  if (!hubUrl || !store.token()) return;
  const hub = normalizeHubUrl(hubUrl);
  if (!hub) return log(`hub address: ${hubUrl} is not an http:// or https:// address`);
  const { startedWith, hubUrl: current } = store.get();
  if (hub === startedWith) return;
  if (hub === current) return store.set({ startedWith: hub });
  log(`hub address: started with ${hub}, moving there from ${current}`);
  for (let delay = retryMs; !signal?.aborted; delay = Math.min(delay * 2, 5 * 60_000)) {
    if (!store.token()) return; // unpaired meanwhile
    try {
      await link.changeHub(hub);
      store.set({ startedWith: hub });
      return;
    } catch (e) {
      if (!(e instanceof HubAddressError)) throw e;
      if (e.code === "unknownDevice") {
        log(`hub address: the hub at ${hub} doesn't know this device; pair it again: ${NEW_CODE}`);
        link.unpair();
        store.set({ hubUrl: hub });
        return;
      }
      // unreachable, hubOff: it may start after this machine. The old address is still tried meanwhile.
      log(`hub address: ${e.code} at ${hub}, trying again in ${Math.round(delay / 1000)} s`);
      await sleep(delay, signal);
    }
  }
}
