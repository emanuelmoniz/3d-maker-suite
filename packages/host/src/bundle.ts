import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "./zip.ts";

export class BundleError extends Error {
  readonly code: "fetch_failed" | "bad_checksum";
  constructor(code: BundleError["code"]) {
    super(code);
    this.code = code;
  }
}

const OS: Record<string, string> = { win32: "windows", darwin: "macos", linux: "linux" };

/**
 * The name of a product's app-only zip in a release (packaging/build.mjs): `<id>-<tag>-app-<os>-<arch>.zip`
 * for this machine, so an ARM machine takes the `linux-arm64` one (ADR-0024).
 */
export function bundleAsset(
  id: string,
  tag: string,
  platform: string = process.platform,
  arch: string = process.arch,
) {
  return `${id}-${tag}-app-${OS[platform]}-${arch}.zip`;
}

/** The `<hash>` of `asset` in a `sha256sum` listing (`<hash>  <name>` or `<hash> *<name>`). */
const checksumOf = (sums: string, asset: string) =>
  sums
    .split("\n")
    .map((l) => l.trim().split(/ [ *]/))
    .find(([, name]) => name === asset)?.[0];

/**
 * Downloads `<base>/<asset>` (a zip) and `<base>/SHA256SUMS`, checks the zip against its line and
 * unpacks it into `dest`, which it replaces. Leaves nothing behind when it throws a BundleError.
 */
export async function fetchBundle(base: string, asset: string, dest: string, download = fetch) {
  const get = async (url: string) => {
    try {
      const res = await download(url, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok) throw new Error(String(res.status));
      // ponytail: the whole zip in memory (~50 MB); stream it if bundles grow a lot.
      return Buffer.from(await res.arrayBuffer());
    } catch {
      throw new BundleError("fetch_failed");
    }
  };
  const want = checksumOf((await get(`${base}/SHA256SUMS`)).toString("utf8"), asset);
  const zip = await get(`${base}/${asset}`);
  if (!want || createHash("sha256").update(zip).digest("hex") !== want)
    throw new BundleError("bad_checksum");

  const tmp = mkdtempSync(join(tmpdir(), "bundle-"));
  const file = join(tmp, "download.zip");
  rmSync(dest, { recursive: true, force: true });
  try {
    writeFileSync(file, zip);
    await extract(file, dest);
  } catch {
    rmSync(dest, { recursive: true, force: true });
    throw new BundleError("fetch_failed");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
