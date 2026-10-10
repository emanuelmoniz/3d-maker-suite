import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { orcaDefaultDirs, orcaSlicerLibrary } from "./index.ts";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, json: unknown) => {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(json));
};

describe("orca library", () => {
  it("reads user presets from default/ and <uuid>/, and system presets nested by brand", async () => {
    dir = mkdtempSync(join(tmpdir(), "orca-"));
    const f = (name: string, extra = {}) => ({
      name,
      filament_type: ["PLA"],
      filament_vendor: ["Acme"],
      ...extra,
    });
    put("user/default/filament/Mine.json", f("Mine"));
    put("user/de36f71b-506a/filament/Synced.json", f("Synced"));
    put(
      "system/BBL/filament/eSUN/eSUN PLA @BBL A1.json",
      f("eSUN PLA @BBL A1", { instantiation: "true" }),
    );
    const lib = orcaSlicerLibrary(() => [dir]);
    const ids = (await lib.read(dir, { includeSystem: true })).map((p) => p.presetId).sort();
    expect(ids).toEqual(["system/eSUN PLA", "user/Mine", "user/Synced"]);
  });

  it("finds the config folder per OS", () => {
    expect(orcaDefaultDirs("win32", { APPDATA: "C:A" }, "h")[0]).toMatch(/OrcaSlicer$/);
    expect(orcaDefaultDirs("darwin", {}, "/h")[0]).toContain("Application Support");
  });
});
