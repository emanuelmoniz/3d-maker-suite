import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { presetFileName, presetText } from "@3d-maker-suite/host";
import { describe, expect, it } from "vitest";
import { infoText, isRunningIn, nextInfo, parseInfo, systemPresets } from "./presetInstall.ts";

// As Bambu Studio and OrcaSlicer wrote them on real installs (ADR-0017).
const SYNCED =
  "sync_info = \nuser_id = 2054892209\nsetting_id = PFUS40ed5c61a77e9d\nbase_id = GFSA19_02\nupdated_time = 1792711979\n";
const TOMBSTONE =
  "sync_info = delete\nuser_id = de36f71b\nsetting_id = df6216b8-6da0-5810\nbase_id = GFSA00_04\nupdated_time = 1793645147\n";

describe("the .info writer", () => {
  it("reads a slicer's file and writes the same bytes back", () => {
    const info = parseInfo(SYNCED);
    expect(info).toEqual({
      sync_info: "",
      user_id: "2054892209",
      setting_id: "PFUS40ed5c61a77e9d",
      base_id: "GFSA19_02",
      updated_time: 1792711979,
    });
    expect(infoText(info)).toBe(SYNCED);
    expect(parseInfo(SYNCED.replaceAll("\n", "\r\n"))).toEqual(info);
  });

  it("a new preset: create, no setting_id, the system preset's id", () => {
    expect(nextInfo(null, "123", "GFSA04", 1000)).toEqual({
      sync_info: "create",
      user_id: "123",
      setting_id: "",
      base_id: "GFSA04",
      updated_time: 1000,
    });
  });

  it("a cloud copy: update, the same ids, and the time only goes up", () => {
    const old = parseInfo(SYNCED);
    const behind = nextInfo(old, "2054892209", "OTHER", 1792711000);
    expect(behind).toMatchObject({
      sync_info: "update",
      setting_id: "PFUS40ed5c61a77e9d",
      base_id: "GFSA19_02",
      updated_time: 1792711980,
    });
    expect(nextInfo(old, "2054892209", "", 1792720000).updated_time).toBe(1792720000);
  });

  it("an update leads the cloud's clock; a create and a later old time don't change", () => {
    const old = parseInfo(SYNCED);
    const lead = 9 * 3600;
    expect(nextInfo(old, "1", "", 1792711000, lead).updated_time).toBe(1792711000 + lead);
    expect(nextInfo(old, "1", "", 1000, lead).updated_time).toBe(1792711980);
    expect(nextInfo(null, "1", "A", 1000, lead).updated_time).toBe(1000);
  });

  it("not uploaded yet: still a create; a pending delete has a cloud copy: update", () => {
    const pending = parseInfo(
      "sync_info = create\nuser_id = 1\nsetting_id = \nbase_id = A\nupdated_time = 5\n",
    );
    expect(nextInfo(pending, "1", "B", 4)).toMatchObject({
      sync_info: "create",
      setting_id: "",
      base_id: "A",
      updated_time: 6,
    });
    expect(nextInfo(parseInfo(TOMBSTONE), "de36f71b", "", 1).sync_info).toBe("update");
  });

  it("damaged: starts over rather than throw", () => {
    expect(parseInfo("nonsense")).toEqual({
      sync_info: "",
      user_id: "",
      setting_id: "",
      base_id: "",
      updated_time: 0,
    });
  });
});

describe("the slicer's json style", () => {
  const json = { name: "A", inherits: "B", list: ["1", "2"], empty: [], nested: { z: 1, a: 2 } };

  it("is Studio's: sorted, 4 spaces, CRLF, with a last line end", () => {
    expect(presetText(json, "    ", "\r\n")).toBe(
      '{\r\n    "empty": [],\r\n    "inherits": "B",\r\n    "list": [\r\n        "1",\r\n        "2"\r\n    ],\r\n    "name": "A",\r\n    "nested": {\r\n        "a": 2,\r\n        "z": 1\r\n    }\r\n}\r\n',
    );
  });

  it("is Orca's with a tab, and a new line inside a value stays escaped", () => {
    expect(presetText({ a: "x\ny" }, "\t", "\r\n")).toBe('{\r\n\t"a": "x\\ny"\r\n}\r\n');
    expect(presetText({ a: 1 }, "\t", "\n")).toBe('{\n\t"a": 1\n}\n');
  });
});

describe("is the slicer closed?", () => {
  const TASKLIST =
    '"System Idle Process","0","Services","0","8 K"\n"bambu-studio.exe","42","Console","1","1 K"\n';
  const MAC = "/usr/sbin/cfprefsd\n/Applications/BambuStudio.app/Contents/MacOS/BambuStudio\n";
  const LINUX = "systemd\nkworker/0:1\nbambu-studio\n";

  it("finds it on each OS, by one name", () => {
    expect(isRunningIn(TASKLIST, "bambu-studio")).toBe(true);
    expect(isRunningIn(MAC, "bambu-studio")).toBe(true);
    expect(isRunningIn(LINUX, "bambu-studio")).toBe(true);
    expect(
      isRunningIn("/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer\n", "orca-slicer"),
    ).toBe(true);
  });

  it("another program isn't it", () => {
    expect(isRunningIn(TASKLIST, "orca-slicer")).toBe(false);
    expect(isRunningIn('"bambu-studio-helper.exe","1"\n', "bambu-studio")).toBe(false);
  });

  it("no list means it may be: nothing is written", () => {
    expect(isRunningIn("", "bambu-studio")).toBe(true);
    expect(isRunningIn("\r\n", "bambu-studio")).toBe(true);
  });
});

describe("a slicer's system presets", () => {
  const put = (root: string, rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };

  it("reads names and ids per kind; Orca's binary files give none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "presets-system-"));
    try {
      expect(await systemPresets(dir)).toBeNull();
      put(dir, "system/BBL.opc", "ZCRO");
      expect(await systemPresets(dir)).toBeNull();
      put(dir, "system/BBL/filament/filaments_color_codes.json", '{"data":[]}');
      expect(await systemPresets(dir)).toBeNull();

      put(
        dir,
        "system/BBL/filament/Pure.json",
        '{"name":"Bambu PLA Pure @BBL A1","setting_id":"GFSA19_02"}',
      );
      put(dir, "system/BBL/filament/base.json", '{"name":"Bambu PLA Pure @base"}');
      put(dir, "system/BBL/process/Fast.json", '{"name":"Fast","setting_id":"GP1"}');
      put(dir, "system/BBL.json", '{"name":"BBL"}');
      const found = await systemPresets(dir);
      expect(found?.filament.get("Bambu PLA Pure @BBL A1")).toBe("GFSA19_02");
      expect(found?.filament.get("Bambu PLA Pure @base")).toBe("");
      expect(found?.process.get("Fast")).toBe("GP1");
      expect(found?.machine.size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("a hub name can't leave the folder", () => {
  expect(presetFileName("../../evil")).toBe("..-..-evil.json");
  expect(presetFileName("..")).toBe("preset.json");
  expect(presetFileName("a\\b:c")).toBe("a-b-c.json");
});
