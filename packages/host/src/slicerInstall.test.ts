import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { afterEach, beforeEach, expect, it } from "vitest";
import yazl from "yazl";
import { cleanPartials, helpVersion, InstallError, installSlicer } from "./slicerInstall.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slicer-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const zip = async () => {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from("exe"), "slicer.exe");
  z.addBuffer(Buffer.from("symbols"), "slicer.pdb");
  z.end();
  return buffer(z.outputStream);
};
const asset = (
  body: Buffer,
  digest = `sha256:${createHash("sha256").update(body).digest("hex")}`,
) => ({
  name: "slicer.zip",
  size: body.length,
  digest,
  url: "https://dl/slicer.zip",
});
const serve = (body: Buffer) => async () => new Response(new Uint8Array(body));

it("installs a version, reports its phases and drops the old one but `keep`", async () => {
  mkdirSync(join(dir, "1.0.0"));
  mkdirSync(join(dir, "config"));
  const z = await zip();
  const phases: string[] = [];
  const exe = await installSlicer(
    dir,
    { version: "2.0.0", asset: asset(z), exe: "slicer.exe" },
    {
      download: serve(z),
      smoke: async (e) => expect(existsSync(e)).toBe(true),
      onProgress: (p) => phases.at(-1) !== p.phase && phases.push(p.phase),
      keep: ["config"],
    },
  );
  expect(exe).toBe(join(dir, "2.0.0", "slicer.exe"));
  expect(phases).toEqual(["download", "verify", "unpack", "test"]);
  expect(readdirSync(dir).sort()).toEqual(["2.0.0", "config"]);
  expect(existsSync(join(dir, "2.0.0", "slicer.pdb"))).toBe(false);
});

it.each([
  ["a wrong digest", { digest: `sha256:${"0".repeat(64)}` }, "bad_digest"],
  ["a failed smoke test", { smokeFails: true }, "smoke_failed"],
] as const)("keeps the old version on %s", async (_, c, code) => {
  mkdirSync(join(dir, "1.0.0"));
  const z = await zip();
  const err = await installSlicer(
    dir,
    {
      version: "2.0.0",
      asset: asset(z, "digest" in c ? c.digest : undefined),
      exe: "slicer.exe",
    },
    {
      download: serve(z),
      smoke: async () => {
        if ("smokeFails" in c) throw new InstallError("smoke_failed", "exit 1");
      },
    },
  ).catch((e) => e);
  expect(err).toBeInstanceOf(InstallError);
  expect(err.code).toBe(code);
  expect(readdirSync(dir)).toEqual(["1.0.0"]);
});

it("fails a download that isn't there", async () => {
  const err = await installSlicer(
    dir,
    { version: "2.0.0", asset: asset(Buffer.from("")), exe: "slicer.exe" },
    { download: async () => new Response(null, { status: 404 }) },
  ).catch((e) => e);
  expect(err.code).toBe("fetch_failed");
  expect(err.detail).toBe("HTTP 404");
});

it("cleans what a restart left behind", () => {
  mkdirSync(join(dir, "a", "2.0.0.partial"), { recursive: true });
  mkdirSync(join(dir, "a", "1.0.0"));
  writeFileSync(join(dir, "a", "download.zip"), "");
  cleanPartials(dir);
  expect(readdirSync(join(dir, "a"))).toEqual(["1.0.0"]);
});

it.each([
  ["BambuStudio-02.08.02.61:\nUsage: bambu-studio [ OPTIONS ]", "02.08.02.61"],
  ["OrcaSlicer-2.5.0-beta2:\nUsage", "2.5.0-beta2"],
  ["PrusaSlicer-2.9.2+win64 based on Slic3r", "2.9.2"],
  ["Usage: slicer [ OPTIONS ]", null],
  ["", null],
])("reads the version of --help output %j", (out, version) => {
  expect(helpVersion(out)).toBe(version);
});
