import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { extract, overlaySystem, zipFolder } from "./zip.ts";

const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

describe("overlaySystem", () => {
  it("backs up first, writes only preset files and deletes nothing", async () => {
    const root = mkdtempSync(join(tmpdir(), "overlay-"));
    const src = join(root, "src");
    put(join(src, "BBL.json"), '{"version":"2"}');
    put(join(src, "BBL", "machine", "a.json"), "new");
    put(join(src, ".from-device"), "x");
    const zip = join(root, "in.zip");
    await zipFolder(src, zip, "system/");

    const dir = join(root, "config");
    put(join(dir, "system", "BBL.json"), '{"version":"1"}');
    put(join(dir, "system", "BBL", "bed.stl"), "mine");
    const backup = join(root, "backup.zip");
    await overlaySystem(zip, dir, backup);

    expect(readFileSync(join(dir, "system", "BBL.json"), "utf8")).toBe('{"version":"2"}');
    expect(readFileSync(join(dir, "system", "BBL", "machine", "a.json"), "utf8")).toBe("new");
    expect(readFileSync(join(dir, "system", "BBL", "bed.stl"), "utf8")).toBe("mine");
    expect(existsSync(join(dir, "system", ".from-device"))).toBe(false);
    // The backup holds the folder as it was.
    const out = join(root, "restored");
    await extract(backup, out);
    expect(readFileSync(join(out, "system", "BBL.json"), "utf8")).toBe('{"version":"1"}');
  });
});
