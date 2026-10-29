import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallError } from "@3d-maker-suite/host";
import { describe, expect, it } from "vitest";
import {
  createSlicers,
  type Found,
  findSlicers,
  iconPath,
  parseFlatpak,
  parseReg,
  plistString,
  plistVersion,
} from "./slicers.ts";
import { openStore } from "./state.ts";

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
    expect(
      plistString(
        "<key>CFBundleExecutable</key><string>BambuStudio</string>",
        "CFBundleExecutable",
      ),
    ).toBe("BambuStudio");
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
        { id: "bambu-studio", path: exe, cmd: exe, args: [], cli: { cmd: exe, args: [] } },
      ]);
    expect(await findSlicers(known, "win32", reg("C:\\nope\\bambu-studio.exe"))).toEqual([]);
    expect(
      await findSlicers(known, "linux", async () => "com.bambulab.BambuStudio\t2.8\n"),
    ).toMatchObject([
      {
        cmd: "flatpak",
        args: ["run", "com.bambulab.BambuStudio"],
        cli: { cmd: "flatpak", args: ["run", "com.bambulab.BambuStudio"] },
      },
    ]);
  });
});

describe("which slicer opens", () => {
  const slicer = (id: string): Found => ({
    id,
    name: id,
    version: null,
    path: id,
    cmd: id,
    args: [],
    cli: { cmd: id, args: [] },
  });

  it("the one asked for, else the default, else the only one; several and none: the hub asks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slicers-"));
    try {
      const store = openStore(dir);
      const puts: unknown[] = [];
      let found = [slicer("bambu-studio")];
      const slicers = createSlicers({
        store,
        log: () => {},
        find: async () => found,
        request: async (_path, init) => {
          if (init?.method === "PUT") puts.push(init.body);
          return new Response("[]");
        },
      });
      await slicers.refresh();
      expect(slicers.pick()?.id).toBe("bambu-studio");

      found = [slicer("bambu-studio"), slicer("orca-slicer")];
      await slicers.refresh();
      expect(slicers.pick()).toBeUndefined();
      expect(slicers.pick("orca-slicer")?.id).toBe("orca-slicer");

      store.set({ defaultSlicer: "orca-slicer" });
      await slicers.refresh();
      expect(slicers.pick()?.id).toBe("orca-slicer");
      expect(slicers.pick("bambu-studio")?.id).toBe("bambu-studio");
      // The hub learns which one is the default.
      expect(puts.at(-1)).toMatchObject([
        { id: "bambu-studio", default: false },
        { id: "orca-slicer", default: true },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("slice worker", () => {
  /** createSlicers with a fake hub: what it was sent, by path. */
  const setup = (opts: Partial<Parameters<typeof createSlicers>[0]> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "worker-"));
    const sent: { path: string; body: unknown }[] = [];
    const slicers = createSlicers({
      store: openStore(dir),
      log: () => {},
      dataDir: dir,
      find: async () => [
        {
          id: "bambu-studio",
          name: "Bambu Studio",
          version: "02.08.02.61",
          path: "C:BS\bambu-studio.exe",
          cmd: "C:BS\bambu-studio.exe",
          args: [],
          cli: { cmd: "C:BS\bambu-studio.exe", args: [] },
        },
      ],
      request: async (path, init) => {
        sent.push({ path, body: init?.body });
        return new Response(path === "/slicers/managed" ? '["keep"]' : "[]");
      },
      ...opts,
    });
    return { dir, sent, slicers, done: () => rmSync(dir, { recursive: true, force: true }) };
  };
  const req = "00000000-0000-4000-8000-000000000001";
  const integrationId = "00000000-0000-4000-8000-000000000002";

  it("checks a found slicer with its cli, and a typed path; reports why one doesn't run", async () => {
    const ran: string[][] = [];
    const t = setup({
      smoke: async (cmd, args = []) => {
        ran.push([cmd, ...args]);
        if (cmd === "/bad") throw new InstallError("smoke_failed", "exit 1");
        return cmd === "/opt/Bambu.AppImage" ? "02.09.00.01" : null;
      },
    });
    try {
      await t.slicers.refresh();
      await t.slicers.check({ type: "slicer.check", requestId: req, slicer: "bambu-studio" });
      await t.slicers.check({ type: "slicer.check", requestId: req, path: "/opt/Bambu.AppImage" });
      await t.slicers.check({ type: "slicer.check", requestId: req, path: "/bad" });
      await t.slicers.check({ type: "slicer.check", requestId: req, slicer: "orca-slicer" });
      expect(ran).toEqual([["C:BS\bambu-studio.exe"], ["/opt/Bambu.AppImage"], ["/bad"]]);
      expect(t.sent.filter((s) => s.path.startsWith("/replies/")).map((s) => s.body)).toEqual([
        { ok: true, result: { path: "C:BS\bambu-studio.exe", version: "02.08.02.61" } },
        { ok: true, result: { path: "/opt/Bambu.AppImage", version: "02.09.00.01" } },
        { ok: false, code: "smoke_failed" },
        { ok: false, code: "no_slicer" },
      ]);
    } finally {
      t.done();
    }
  });

  it("installs into its data folder, answers first and reports until done or failed", async () => {
    const t = setup({
      install: async (dir, target, opts) => {
        opts?.onProgress?.({ phase: "download", received: 5 });
        opts?.onProgress?.({ phase: "verify", received: 10 });
        if (target.version === "9") throw new InstallError("bad_digest");
        return join(dir, target.version, target.exe);
      },
    });
    const target = {
      version: "2.0.0",
      exe: "bambu-studio.exe",
      asset: { name: "a.zip", size: 10, digest: "sha256:x", url: "https://dl/a.zip" },
    };
    try {
      await t.slicers.install({ type: "slicer.install", requestId: req, integrationId, target });
      await t.slicers.install({
        type: "slicer.install",
        requestId: req,
        integrationId,
        target: { ...target, version: "9" },
      });
      expect(t.sent[0]).toEqual({ path: `/replies/${req}`, body: { ok: true, result: null } });
      const reports = t.sent
        .filter((s) => s.path === "/slicers/install")
        .map(
          (s) =>
            s.body as {
              status: { state: string; phase: string | null; error: string | null };
              result?: unknown;
            },
        );
      expect(reports.map((r) => [r.status.state, r.status.phase])).toEqual([
        ["running", "download"],
        ["running", "verify"],
        ["done", null],
        ["running", "download"],
        ["running", "verify"],
        ["failed", null],
      ]);
      expect(reports[2]?.result).toEqual({
        path: join(t.dir, "slicers", integrationId, "2.0.0", "bambu-studio.exe"),
        version: "2.0.0",
      });
      expect(reports[5]?.status.error).toBe("bad_digest");
    } finally {
      t.done();
    }
  });

  it("removes one, and on connect drops those the hub no longer has", async () => {
    const t = setup();
    try {
      for (const id of [integrationId, "keep", "gone"])
        mkdirSync(join(t.dir, "slicers", id, "1.0"), { recursive: true });
      await t.slicers.remove({ type: "slicer.remove", requestId: req, integrationId });
      expect(existsSync(join(t.dir, "slicers", integrationId))).toBe(false);
      await t.slicers.prune();
      expect(readdirSync(join(t.dir, "slicers"))).toEqual(["keep"]);
    } finally {
      t.done();
    }
  });
});
