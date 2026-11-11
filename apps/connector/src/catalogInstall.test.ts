import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogInstallSlicer, DesktopSlicer } from "@3d-maker-suite/core";
import { extract, zipFolder } from "@3d-maker-suite/host";
import { describe, expect, it } from "vitest";
import { createCatalogInstall } from "./catalogInstall.ts";
import type { Request } from "./roots.ts";

const slicer = {
  id: "bambu-studio",
  library: "bambu-studio",
  process: "bambu-studio",
} as DesktopSlicer;
const RUNNING = '"System","4"\n"bambu-studio.exe","99"\n';
const CLOSED = '"System","4"\n';

/** A slicer's config folder with `system/` at `version`, and a hub that serves its copy at `hub`. */
async function setup(version: string, hub: string) {
  const dir = mkdtempSync(join(tmpdir(), "catalog-install-"));
  const config = join(dir, "config");
  const vendor = (at: string, v: string) => {
    mkdirSync(join(at, "system", "BBL"), { recursive: true });
    writeFileSync(join(at, "system", "BBL.json"), JSON.stringify({ version: v }));
  };
  vendor(config, version);
  // The slicer's own file, which the hub's copy doesn't carry: it stays.
  writeFileSync(join(config, "system", "BBL", "bed.stl"), "solid");
  const copy = join(dir, "hub");
  vendor(copy, hub);
  writeFileSync(join(copy, "system", "BBL", "Bambu PLA.json"), "{}");
  writeFileSync(join(copy, "system", ".from-device"), "id");
  await zipFolder(join(copy, "system"), join(dir, "hub.zip"), "system/");

  let processes = RUNNING;
  const reports: CatalogInstallSlicer[][] = [];
  const request: Request = async (path, init) => {
    if (path === "/catalog/bambu-studio/system")
      return new Response(readFileSync(join(dir, "hub.zip")));
    if (path === "/catalog-install" && init?.method === "PUT") {
      reports.push(init.body as CatalogInstallSlicer[]);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };
  const install = createCatalogInstall({
    request,
    slicers: () => [slicer],
    dataDir: dir,
    log: () => {},
    configDir: () => config,
    processes: async () => processes,
  });
  const version_ = () =>
    JSON.parse(readFileSync(join(config, "system", "BBL.json"), "utf8")).version;
  return {
    dir,
    config,
    install,
    reports,
    version: version_,
    vendor: (v: string) => vendor(config, v),
    close: () => {
      processes = CLOSED;
    },
  };
}

describe("Receive catalog (ADR-0021)", () => {
  it("waits for the slicer to close, backs system/ up, then lays the hub's copy over it", async () => {
    const s = await setup("1", "2");
    await s.install.set({ "bambu-studio": "BBL=2" });
    expect(s.version()).toBe("1");
    expect(s.reports.at(-1)).toEqual([
      {
        library: "bambu-studio",
        hub: "BBL=2",
        fingerprint: "BBL=1",
        waiting: true,
        backup: null,
        error: null,
      },
    ]);

    s.close();
    await s.install.set({ "bambu-studio": "BBL=2" });
    expect(s.version()).toBe("2");
    expect(existsSync(join(s.config, "system", "BBL", "Bambu PLA.json"))).toBe(true);
    // Nothing is deleted, and the hub's mark isn't written.
    expect(existsSync(join(s.config, "system", "BBL", "bed.stl"))).toBe(true);
    expect(existsSync(join(s.config, "system", ".from-device"))).toBe(false);
    const backup = join(s.dir, "catalog-backups", "bambu-studio.zip");
    await extract(backup, join(s.dir, "restored"));
    expect(
      JSON.parse(readFileSync(join(s.dir, "restored", "system", "BBL.json"), "utf8")).version,
    ).toBe("1");
    expect(s.reports.at(-1)).toEqual([
      {
        library: "bambu-studio",
        hub: "BBL=2",
        fingerprint: "BBL=2",
        waiting: false,
        backup: { path: backup, at: expect.any(String) },
        error: null,
      },
    ]);

    // A slicer update recopies system/: its fingerprint changes, so the copy goes in again.
    s.vendor("3");
    await s.install.set({ "bambu-studio": "BBL=2" });
    expect(s.version()).toBe("2");
    s.install.stop();
  });

  it("writes nothing while the hub has no copy, or for a library it doesn't receive", async () => {
    const s = await setup("1", "2");
    s.close();
    await s.install.set({ "bambu-studio": null });
    expect(s.version()).toBe("1");
    expect(s.reports.at(-1)?.[0]).toMatchObject({ hub: null, waiting: false });
    await s.install.set({});
    expect(s.version()).toBe("1");
    s.install.stop();
  });
});
