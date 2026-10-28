import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { afterEach, beforeEach, expect, it } from "vitest";
import yazl from "yazl";
import { BundleError, fetchBundle } from "./bundle.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bundle-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const zip = async () => {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from('{"version":"9.9.9"}'), "package.json");
  z.end();
  return buffer(z.outputStream);
};
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** A stand-in for the release download folder. */
const site = (files: Record<string, Buffer | string>) => async (url: string | URL | Request) => {
  const body = files[String(url).replace("https://dl/", "")];
  if (body === undefined) return new Response(null, { status: 404 });
  return new Response(typeof body === "string" ? body : new Uint8Array(body));
};

it("checks the zip against SHA256SUMS and unpacks it", async () => {
  const z = await zip();
  const dest = join(dir, "9.9.9.partial");
  await fetchBundle(
    "https://dl",
    "a.zip",
    dest,
    site({ "a.zip": z, SHA256SUMS: `${sha(z)}  a.zip\n` }),
  );
  expect(JSON.parse(readFileSync(join(dest, "package.json"), "utf8")).version).toBe("9.9.9");
});

it.each([
  ["a wrong hash", { SHA256SUMS: `${"0".repeat(64)}  a.zip\n` }, "bad_checksum"],
  ["no line for the asset", { SHA256SUMS: "abc  other.zip\n" }, "bad_checksum"],
  ["no SHA256SUMS", {}, "fetch_failed"],
] as const)("refuses %s and leaves nothing behind", async (_, extra, code) => {
  const dest = join(dir, "9.9.9.partial");
  const err = await fetchBundle(
    "https://dl",
    "a.zip",
    dest,
    site({ "a.zip": await zip(), ...extra }),
  )
    .then(() => null)
    .catch((e) => e);
  expect(err).toBeInstanceOf(BundleError);
  expect(err.code).toBe(code);
  expect(existsSync(dest)).toBe(false);
});
