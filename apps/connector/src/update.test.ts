import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { afterEach, beforeEach, expect, it } from "vitest";
import yazl from "yazl";
import { createUpdater } from "./update.ts";

let install: string;
beforeEach(() => {
  install = mkdtempSync(join(tmpdir(), "connector-install-"));
});
afterEach(() => rmSync(install, { recursive: true, force: true }));

const os = { win32: "windows", darwin: "macos", linux: "linux" }[process.platform as string];
const asset = `3d-maker-suite-connector-v5.1.0-app-${os}-${process.arch}.zip`;

/** A download folder with the 5.1.0 connector zip and its SHA256SUMS; counts requests. */
const release = async () => {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from('{"version":"5.1.0"}'), "apps/connector/package.json");
  z.end();
  const zip = await buffer(z.outputStream);
  const files: Record<string, Buffer | string> = {
    [asset]: zip,
    SHA256SUMS: `${createHash("sha256").update(zip).digest("hex")}  ${asset}\n`,
  };
  const asked: string[] = [];
  const download = async (url: string | URL | Request) => {
    asked.push(String(url));
    const body = files[String(url).replace("https://dl/", "")];
    if (body === undefined) return new Response(null, { status: 404 });
    return new Response(typeof body === "string" ? body : new Uint8Array(body));
  };
  return { download: download as typeof fetch, asked };
};

const env = { APP_INSTALL: "bundle", APP_INSTALL_DIR: "", APP_DOWNLOAD_URL: "https://dl" };

it("follows a newer hub: versions/<v>, pending.json, exit 75", async () => {
  const { download } = await release();
  const exits: number[] = [];
  const u = createUpdater({
    version: "5.0.0",
    env: { ...env, APP_INSTALL_DIR: install },
    download,
    exit: (c) => exits.push(c),
  });
  await u.follow("5.1.0");
  expect(existsSync(join(install, "versions", "5.1.0", "apps/connector/package.json"))).toBe(true);
  expect(existsSync(join(install, "versions", "5.1.0.partial"))).toBe(false);
  expect(JSON.parse(readFileSync(join(install, ".update", "pending.json"), "utf8"))).toEqual({
    action: "update",
    toVersion: "5.1.0",
    from: "5.0.0",
    fromVersion: "5.0.0",
  });
  expect(exits).toEqual([75]);
});

it("stays put for the same or an older hub, outside an install, and after a failed try", async () => {
  const { download, asked } = await release();
  const exit = () => {
    throw new Error("must not exit");
  };
  const at = (version: string, e: Record<string, string> = { ...env, APP_INSTALL_DIR: install }) =>
    createUpdater({ version, env: e, download, exit });

  await at("5.1.0").follow("5.1.0");
  const older = at("5.2.0");
  await older.follow("5.1.0");
  expect(older.state().hubOlder).toBe(true);
  await at("5.0.0", {}).follow("5.1.0"); // git checkout / pnpm start

  // The launcher went back from 5.1.0 (result.json): no second try, and the page says so.
  mkdirSync(join(install, ".update"));
  writeFileSync(
    join(install, ".update", "result.json"),
    JSON.stringify({ action: "update", toVersion: "5.1.0", ok: false }),
  );
  const failed = at("5.0.0");
  await failed.follow("5.1.0");
  expect(failed.state().failed).toBe("5.1.0");
  expect(asked).toEqual([]);
});

it("keeps running when the download doesn't match its checksum", async () => {
  const { download } = await release();
  const bad: typeof fetch = async (url) =>
    String(url).endsWith("SHA256SUMS")
      ? new Response(`${"0".repeat(64)}  ${asset}\n`)
      : download(url);
  const u = createUpdater({
    version: "5.0.0",
    env: { ...env, APP_INSTALL_DIR: install },
    download: bad,
    exit: () => {
      throw new Error("must not exit");
    },
  });
  await u.follow("5.1.0");
  expect(u.state().error).toBe("bad_checksum");
  expect(existsSync(join(install, "versions"))).toBe(false);
});
