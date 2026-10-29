import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import type {
  ReleaseAsset,
  SLICER_INSTALL_PHASES,
  SlicerInstallError,
  SlicerSystem,
} from "@3d-maker-suite/core";
import { extract } from "./zip.ts";

// A managed slicer (ADR-0013), installed by the server and by slice workers (ADR-0014):
// <dir>/<version>/ holds the program. A new version replaces the old one only once its smoke test
// passed; anything else in <dir> (the server's `config`) is the caller's.

const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;
const SMOKE_TIMEOUT_MS = 60_000;
/** Windows' STATUS_DLL_NOT_FOUND: Bambu's zip relies on the system's VC++ runtime. */
const DLL_NOT_FOUND = 0xc0000135 | 0;

export type SlicerInstallPhase = (typeof SLICER_INSTALL_PHASES)[number];

export class InstallError extends Error {
  readonly code: SlicerInstallError;
  readonly detail?: string;
  constructor(code: SlicerInstallError, detail?: string) {
    super(detail ?? code);
    this.code = code;
    this.detail = detail;
  }
}

/** A phase's error when the failure wasn't one of ours (e.g. a full disk). */
export const PHASE_ERRORS = {
  download: "fetch_failed",
  verify: "bad_digest",
  unpack: "unpack_failed",
  test: "smoke_failed",
} as const satisfies Record<SlicerInstallPhase, SlicerInstallError>;

/** Runs a program; `out` keeps the start of its stdout, else output is ignored (an AppImage lists every file it extracts). */
const exec = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; out?: { text: string } } = {},
) =>
  new Promise<number>((ok, fail) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", opts.out ? "pipe" : "ignore", "ignore"],
      windowsHide: true,
      ...(opts.timeoutMs && { signal: AbortSignal.timeout(opts.timeoutMs) }),
    });
    const out = opts.out;
    if (out)
      child.stdout?.on("data", (b: Buffer) => {
        if (out.text.length < 4096) out.text += b.toString("utf8");
      });
    child.once("error", fail);
    child.once("exit", (code, signal) => ok(code ?? (signal ? -1 : 0)));
  });

const must = async (cmd: string, args: string[], cwd?: string) => {
  const code = await exec(cmd, args, { cwd });
  if (code !== 0) throw new Error(`${cmd} exited with ${code}`);
};

/** The version a slicer's `--help` names first: `BambuStudio-02.08.02.61:`, `OrcaSlicer-2.5.0`. */
export const helpVersion = (out: string) =>
  /^\s*[A-Za-z][\w ]*?[- ]v?(\d+(?:\.\d+)+(?:-[\w.]+)?)/.exec(out)?.[1] ?? null;

/**
 * The program starts and exits cleanly with `--help`, in a temp cwd (it writes result.json and a
 * log). Resolves with the version its output names, if any.
 */
export async function smokeTest(cmd: string, args: string[] = []) {
  const cwd = mkdtempSync(join(tmpdir(), "3dms-smoke-"));
  const out = { text: "" };
  const code = await exec(cmd, [...args, "--help"], { cwd, timeoutMs: SMOKE_TIMEOUT_MS, out })
    .catch((e: Error) => {
      throw new InstallError("smoke_failed", e.message);
    })
    .finally(() => rmSync(cwd, { recursive: true, force: true }));
  if ((code | 0) === DLL_NOT_FOUND) throw new InstallError("vcredist_missing");
  if (code !== 0) throw new InstallError("smoke_failed", `exit ${code | 0}`);
  return helpVersion(out.text);
}

/** By extension (ADR-0013): yauzl without debug symbols, hdiutil, or the AppImage itself. */
async function unpack(file: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  if (file.endsWith(".zip")) return extract(file, dest, (n) => !n.endsWith(".pdb"));
  if (file.endsWith(".dmg")) {
    const mnt = mkdtempSync(join(tmpdir(), "3dms-dmg-"));
    try {
      await must("hdiutil", [
        "attach",
        "-nobrowse",
        "-readonly",
        "-noautoopen",
        "-mountpoint",
        mnt,
        file,
      ]);
      try {
        for (const app of readdirSync(mnt).filter((n) => n.endsWith(".app")))
          await must("cp", ["-R", join(mnt, app), dest]);
      } finally {
        await exec("hdiutil", ["detach", mnt, "-force"]).catch(() => {});
      }
    } finally {
      rmSync(mnt, { recursive: true, force: true });
    }
    return;
  }
  chmodSync(file, 0o755);
  await must(file, ["--appimage-extract"], dest);
}

export function systemInfo(): SlicerSystem {
  const report =
    process.platform === "linux"
      ? (process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
      : undefined;
  return {
    platform: process.platform,
    arch: process.arch,
    glibc: report?.header?.glibcVersionRuntime,
  };
}

/** What to install: the release's asset, and the program inside it. */
export type InstallTarget = { version: string; asset: ReleaseAsset; exe: string };

/**
 * Download (hashed on the way), digest check, unpack into `<version>.partial`, smoke test, then
 * it becomes `<version>` and other versions go (`keep` stays). Throws an `InstallError`; returns
 * the program's path.
 */
export async function installSlicer(
  dir: string,
  { version, asset, exe }: InstallTarget,
  {
    download = fetch,
    smoke = smokeTest,
    onProgress = () => {},
    keep = [],
  }: {
    download?: typeof fetch;
    smoke?: (exe: string) => Promise<unknown>;
    onProgress?: (p: { phase: SlicerInstallPhase; received: number }) => void;
    keep?: string[];
  } = {},
) {
  const file = join(dir, `download${extname(asset.name)}`);
  const partial = join(dir, `${version}.partial`);
  let phase: SlicerInstallPhase = "download";
  let received = 0;
  const step = (p: SlicerInstallPhase) => {
    phase = p;
    onProgress({ phase, received });
  };
  try {
    mkdirSync(dir, { recursive: true });
    rmSync(partial, { recursive: true, force: true });
    const res = await download(asset.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new InstallError("fetch_failed", `HTTP ${res.status}`);
    const hash = createHash("sha256");
    await pipeline(
      Readable.fromWeb(res.body as ReadableStream),
      new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk);
          received += chunk.length;
          onProgress({ phase, received });
          done(null, chunk);
        },
      }),
      createWriteStream(file),
    );

    step("verify");
    if (`sha256:${hash.digest("hex")}` !== asset.digest) throw new InstallError("bad_digest");

    step("unpack");
    await unpack(file, partial);
    rmSync(file, { force: true });

    step("test");
    await smoke(join(partial, exe));

    // Only now the new version replaces the old one.
    const target = join(dir, version);
    rmSync(target, { recursive: true, force: true });
    renameSync(partial, target);
    removeSlicer(dir, [version, ...keep]);
    return join(target, exe);
  } catch (err) {
    rmSync(partial, { recursive: true, force: true });
    rmSync(file, { force: true });
    if (err instanceof InstallError) throw err;
    throw new InstallError(PHASE_ERRORS[phase], (err as Error).message);
  }
}

/** Deletes everything in `dir` but `keep`. */
export function removeSlicer(dir: string, keep: string[] = []) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir))
    if (!keep.includes(f)) rmSync(join(dir, f), { recursive: true, force: true });
}

/** A restart mid-install leaves a half folder or download behind in `<root>/<id>/`. */
export function cleanPartials(root: string) {
  if (!existsSync(root)) return;
  for (const id of readdirSync(root)) {
    const dir = join(root, id);
    for (const f of readdirSync(dir))
      if (f.endsWith(".partial") || f.startsWith("download."))
        rmSync(join(dir, f), { recursive: true, force: true });
  }
}
