import { describe, expect, it } from "vitest";
import { isRunningIn } from "./processes.ts";

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
