import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  type DesktopSlicer,
  type DeviceSlicer,
  type DeviceSlicerCheck,
  desktopSlicerSchema,
  type HubEvent,
  SLICE_TIMEOUT_MS,
  type SlicerInstallStatus,
} from "@3d-maker-suite/core";
import {
  cleanPartials,
  InstallError,
  installSlicer,
  launch,
  removeSlicer,
  runSlicer,
  smokeTest,
} from "@3d-maker-suite/host";
import { z } from "zod";
import type { Request } from "./roots.ts";
import type { Store } from "./state.ts";

/**
 * A slicer found here, its product name (`windowsName`), how to start it with a file, and how to
 * run it headless (`cli`: `--help`, slicing on a worker).
 */
export type Found = DeviceSlicer & {
  name: string;
  cmd: string;
  args: string[];
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
          cmd: path,
          args: [],
          cli: { cmd: path, args: [] },
        });
    }
  } else if (platform === "darwin") {
    for (const k of known) {
      const path = join("/Applications", k.macApp);
      if (!(await isDir(path))) continue;
      const plist = await readFile(join(path, "Contents", "Info.plist"), "utf8").catch(() => "");
      // `open -a`: the file joins the running app, if there is one; headless, its program.
      const exe = plistString(plist, "CFBundleExecutable") ?? k.macApp.replace(/\.app$/, "");
      found.push({
        id: k.id,
        name: k.windowsName,
        version: plistVersion(plist),
        path,
        cmd: "open",
        args: ["-a", path],
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
          cmd: "flatpak",
          args: ["run", k.flatpak],
          cli: { cmd: "flatpak", args: ["run", k.flatpak] },
        });
  }
  return found;
}

/**
 * The slicers on this device: found when the link comes online and reported to the hub, which
 * offers Open only while there is one. The status page picks the default, or none (ask each time).
 */
export function createSlicers({
  request,
  store,
  log,
  dataDir,
  find = findSlicers,
  start = launch,
  smoke = smokeTest,
  install = installSlicer,
  runSlice = runSlicer,
}: {
  request: Request;
  store: Store;
  log: (line: string) => void;
  /** Slice workers' managed slicers go to `<dataDir>/slicers/<integrationId>`; none = not here. */
  dataDir?: string;
  find?: (known: DesktopSlicer[]) => Promise<Found[]>;
  start?: (cmd: string, args: string[]) => Promise<number | undefined>;
  smoke?: (cmd: string, args?: string[]) => Promise<string | null>;
  install?: typeof installSlicer;
  runSlice?: typeof runSlicer;
}) {
  let found: Found[] = [];
  const managedDir = dataDir && join(dataDir, "slicers");
  if (managedDir) cleanPartials(managedDir);
  /** Slice workers: a folder per slice from the hub, and the 3MF pulled last. */
  const sliceDir = dataDir && join(dataDir, "slicing");
  if (sliceDir) rmSync(sliceDir, { recursive: true, force: true }); // what a crash left

  /**
   * A slice's 3MF from the hub, checked against its hash. ponytail: only the last one is kept (a
   * file's plates slice one after another); keep more if workers pull the same files again.
   */
  const pull = async (requestId: string, sha256: string) => {
    const dir = sliceDir as string;
    const dest = join(dir, `${sha256}.3mf`);
    if (await isFile(dest)) return dest;
    const res = await request(`/slices/${requestId}/file`, { long: true });
    if (!res.ok || !res.body)
      throw Object.assign(new Error(`3MF: HTTP ${res.status}`), { code: "EIO" });
    const part = `${dest}.part`;
    const hash = createHash("sha256");
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      async function* (src: AsyncIterable<Buffer>) {
        for await (const chunk of src) {
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(part),
    );
    if (hash.digest("hex") !== sha256) {
      await rm(part, { force: true });
      throw Object.assign(new Error("3MF: wrong hash"), { code: "EIO" });
    }
    for (const n of await readdir(dir)) if (n.endsWith(".3mf")) await rm(join(dir, n));
    await rename(part, dest);
    return dest;
  };
  const reply = (requestId: string, body: object) =>
    request(`/replies/${requestId}`, { method: "POST", body }).catch(() => {});
  /** An install error's code, else the OS one. */
  const codeOf = (e: unknown) =>
    e instanceof InstallError ? e.code : ((e as NodeJS.ErrnoException).code ?? "EIO");

  /**
   * The one asked for, else the default, else the only one found. Several and no default: none,
   * since the hub asks the user which one before it sends `open`.
   */
  const pick = (id = store.get().defaultSlicer) =>
    found.find((f) => f.id === id) ?? (found.length === 1 ? found[0] : undefined);

  return {
    list: () => found,
    pick,
    async refresh() {
      try {
        const res = await request("/slicers");
        if (!res.ok) throw new Error(`slicers: HTTP ${res.status}`);
        found = await find(z.array(desktopSlicerSchema).parse(await res.json()));
        const { defaultSlicer } = store.get();
        const body = found.map(({ id, version, path }) => ({
          id,
          version,
          path,
          default: id === defaultSlicer,
        }));
        const put = await request("/slicers", { method: "PUT", body });
        if (!put.ok) throw new Error(`slicers: HTTP ${put.status}`);
      } catch (e) {
        log(`slicers: ${e instanceof Error ? e.message : e}`);
      }
    },
    /**
     * The hub's `open`: the file synced first (`local` gives its path here), then the slicer
     * started with it (`opened` gets its pid, to release the lock when it exits). Answered once
     * it started, or with the error code.
     */
    async open(
      { requestId, rootId, path, slicer: asked }: Extract<HubEvent, { type: "open" }>,
      local: (rootId: string, path: string) => Promise<string | null>,
      opened: (rootId: string, path: string, pid: number) => void = () => {},
    ) {
      const body = await (async () => {
        const slicer = pick(asked);
        if (!slicer) return { ok: false, code: "no_slicer" };
        const abs = await local(rootId, path);
        if (!abs) return { ok: false, code: "ENOENT" };
        const pid = await start(slicer.cmd, [...slicer.args, abs]);
        if (pid) opened(rootId, path, pid);
        log(`opened ${path} in ${slicer.id}`);
        return { ok: true, result: null };
      })().catch((e: NodeJS.ErrnoException) => {
        log(`open ${path}: ${e.message}`);
        return { ok: false, code: e.code ?? "EIO" };
      });
      await request(`/replies/${requestId}`, { method: "POST", body }).catch(() => {});
    },

    /** Slice workers: a found slicer (its id) or a typed path runs with `--help` here. */
    async check({ requestId, slicer, path }: Extract<HubEvent, { type: "slicer.check" }>) {
      const f = slicer ? found.find((s) => s.id === slicer) : undefined;
      if (slicer && !f) return reply(requestId, { ok: false, code: "no_slicer" });
      const where = f?.path ?? path ?? "";
      try {
        const version = f ? await smoke(f.cli.cmd, f.cli.args) : await smoke(where);
        const result: DeviceSlicerCheck = { path: where, version: f?.version ?? version };
        log(`slicer ${where} runs (${result.version ?? "version unknown"})`);
        await reply(requestId, { ok: true, result });
      } catch (e) {
        log(`slicer ${where}: ${e instanceof Error ? e.message : e}`);
        await reply(requestId, { ok: false, code: codeOf(e) });
      }
    },

    /**
     * Slice workers: the hub's managed slicer into the data folder, no admin rights needed
     * (ADR-0014). Answered at once; progress goes to `PUT /slicers/install`, at most once a second
     * while downloading.
     */
    async install({
      requestId,
      integrationId,
      target,
    }: Extract<HubEvent, { type: "slicer.install" }>) {
      if (!managedDir) return reply(requestId, { ok: false, code: "ENOTSUP" });
      await reply(requestId, { ok: true, result: null });
      const status: SlicerInstallStatus = {
        state: "running",
        phase: "download",
        tag: null,
        received: 0,
        total: target.asset.size,
        error: null,
        detail: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      const send = (result?: DeviceSlicerCheck) =>
        request("/slicers/install", {
          method: "PUT",
          body: { integrationId, status: { ...status }, ...(result && { result }) },
        }).catch(() => {});
      let sentAt = 0;
      log(`installing ${target.asset.name}`);
      try {
        const exe = await install(join(managedDir, integrationId), target, {
          onProgress: ({ phase, received }) => {
            const next = phase !== status.phase;
            Object.assign(status, { phase, received });
            if (next || Date.now() - sentAt > 1000) {
              sentAt = Date.now();
              void send();
            }
          },
        });
        Object.assign(status, { state: "done", phase: null, finishedAt: new Date().toISOString() });
        log(`installed ${target.asset.name}`);
        await send({ path: exe, version: target.version });
      } catch (e) {
        Object.assign(status, {
          state: "failed",
          phase: null,
          error: e instanceof InstallError ? e.code : "fetch_failed",
          detail: e instanceof InstallError ? (e.detail ?? null) : String(e),
          finishedAt: new Date().toISOString(),
        });
        log(`install ${target.asset.name}: ${status.error} ${status.detail ?? ""}`);
        await send();
      }
    },

    /** Slice workers: a managed slicer goes (Remove, or its integration was deleted). */
    async remove({ requestId, integrationId }: Extract<HubEvent, { type: "slicer.remove" }>) {
      if (managedDir) rmSync(join(managedDir, integrationId), { recursive: true, force: true });
      await reply(requestId, { ok: true, result: null });
    },

    /**
     * Slice workers: a slice from the hub (ADR-0014), in `<dataDir>/slicing/<requestId>` (under the
     * home folder: a Flatpak slicer can't read `/tmp`). The 3MF is a synced copy with its hash
     * (`copyOf`), the one pulled last, or pulled now. Each file the run adds goes back, then the
     * exit code; the hub reads the result from those files, as for its own slices.
     */
    async slice(
      { requestId, program, args, files, sha256 }: Extract<HubEvent, { type: "slice" }>,
      copyOf: (sha256: string) => Promise<string | null>,
    ) {
      if (!sliceDir || !store.get().sliceWorker)
        return reply(requestId, { ok: false, code: "ENOTSUP" });
      const work = join(sliceDir, requestId);
      try {
        await mkdir(work, { recursive: true });
        for (const [name, text] of Object.entries(files)) await writeFile(join(work, name), text);
        const file = (await copyOf(sha256)) ?? (await pull(requestId, sha256));
        // A found slicer is known by its path (an app, a Flatpak id); it runs as its `cli`.
        const f = found.find((s) => s.path === program);
        const local = args.map((a) => a.replaceAll("{dir}/", work + sep).replaceAll("{dir}", work));
        log(`slicing ${sha256.slice(0, 12)} with ${program}`);
        const code = await runSlice(
          f?.cli.cmd ?? program,
          [...(f?.cli.args ?? []), ...local, file],
          work,
          AbortSignal.timeout(SLICE_TIMEOUT_MS),
        );
        for (const name of await readdir(work)) {
          if (name in files || !(await isFile(join(work, name)))) continue;
          const res = await request(`/slices/${requestId}/files/${encodeURIComponent(name)}`, {
            method: "PUT",
            file: { stream: createReadStream(join(work, name)) },
          });
          if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: "EIO" });
        }
        await reply(requestId, { ok: true, result: { code } });
      } catch (e) {
        log(`slice: ${e instanceof Error ? e.message : e}`);
        await reply(requestId, { ok: false, code: codeOf(e) });
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },

    /** Online again: the managed slicers the hub no longer has for this device go. */
    async prune() {
      if (!managedDir) return;
      try {
        const res = await request("/slicers/managed");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        removeSlicer(managedDir, z.array(z.string()).parse(await res.json()));
      } catch (e) {
        log(`slicers: ${e instanceof Error ? e.message : e}`);
      }
    },
  };
}

export type Slicers = ReturnType<typeof createSlicers>;
