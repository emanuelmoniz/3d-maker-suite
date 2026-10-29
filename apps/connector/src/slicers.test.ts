import { describe, expect, it } from "vitest";
import { findSlicers, iconPath, parseFlatpak, parseReg, plistVersion } from "./slicers.ts";

const known = [
  {
    id: "bambu-studio",
    windowsName: "Bambu Studio",
    macApp: "BambuStudio.app",
    flatpak: "com.bambulab.BambuStudio",
  },
];

describe("slicer detection", () => {
  it("reads the Uninstall keys, the plist and the Flatpak list", () => {
    const reg = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Bambu Suite
    DisplayName    REG_SZ    Bambu Suite version 01.01.03.52

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Bambu Studio
    DisplayName    REG_SZ    Bambu Studio
    DisplayVersion    REG_SZ    02.08.02.61
    DisplayIcon    REG_SZ    C:\\Program Files\\Bambu Studio\\bambu-studio.exe
`;
    expect(parseReg(reg)).toEqual([
      { DisplayName: "Bambu Suite version 01.01.03.52" },
      {
        DisplayName: "Bambu Studio",
        DisplayVersion: "02.08.02.61",
        DisplayIcon: "C:\\Program Files\\Bambu Studio\\bambu-studio.exe",
      },
    ]);
    expect(iconPath('"C:\\x\\orca-slicer.exe",0')).toBe("C:\\x\\orca-slicer.exe");
    expect(
      plistVersion("<dict><key>CFBundleShortVersionString</key>\n\t<string>2.5.0</string></dict>"),
    ).toBe("2.5.0");
    expect(parseFlatpak("com.bambulab.BambuStudio\t2.8.2.61 Public Release\n")).toEqual(
      new Map([["com.bambulab.BambuStudio", "2.8.2.61 Public Release"]]),
    );
  });

  it("finds only an installed program with the exact name", async () => {
    const reg = (icon: string) => async () =>
      `HKEY_X\n    DisplayName    REG_SZ    Bambu Studio\n    DisplayIcon    REG_SZ    ${icon}\n`;
    // An existing .exe is found; a missing one is not.
    const exe = process.platform === "win32" ? process.execPath : "";
    if (exe)
      expect(await findSlicers(known, "win32", reg(exe))).toMatchObject([
        { id: "bambu-studio", path: exe, cmd: exe, args: [] },
      ]);
    expect(await findSlicers(known, "win32", reg("C:\\nope\\bambu-studio.exe"))).toEqual([]);
    expect(
      await findSlicers(known, "linux", async () => "com.bambulab.BambuStudio\t2.8\n"),
    ).toMatchObject([{ cmd: "flatpak", args: ["run", "com.bambulab.BambuStudio"] }]);
  });
});
