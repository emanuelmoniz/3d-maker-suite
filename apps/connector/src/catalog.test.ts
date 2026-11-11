import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import type { DesktopSlicer } from "@3d-maker-suite/core";
import { extract } from "@3d-maker-suite/host";
import { describe, expect, it } from "vitest";
import { createCatalogSend } from "./catalog.ts";
import type { Request } from "./roots.ts";

const slicer = { id: "bambu-studio", library: "bambu-studio" } as DesktopSlicer;

/** A config folder whose `system/` has one vendor at `version`, and what the connector sends. */
function setup(status = 204, pollMs = 60_000, found = [slicer]) {
  const dir = mkdtempSync(join(tmpdir(), "catalog-send-"));
  const config = join(dir, "config");
  mkdirSync(join(config, "system", "BBL"), { recursive: true });
  // Never sent: only `system/` is.
  writeFileSync(join(config, "BambuStudio.conf"), "{}");
  const version = (v: string) =>
    writeFileSync(join(config, "system", "BBL.json"), JSON.stringify({ version: v }));
  version("1");
  const sent: { path: string; entries: string[] }[] = [];
  const request: Request = async (path, init) => {
    const out = mkdtempSync(join(dir, "sent-"));
    writeFileSync(join(out, "sent.zip"), await buffer(init?.file?.stream as NodeJS.ReadableStream));
    await extract(join(out, "sent.zip"), join(out, "files"));
    const entries = readdirSync(join(out, "files"), { recursive: true, encoding: "utf8" });
    sent.push({ path, entries: entries.map((e) => e.split("\\").join("/")).sort() });
    return new Response(null, { status });
  };
  const send = createCatalogSend({
    request,
    slicers: () => found,
    dataDir: dir,
    log: () => {},
    configDir: () => config,
    pollMs,
  });
  return { send, sent, version, dir };
}

describe("catalog source (ADR-0020)", () => {
  it("sends system/ only when its fingerprint isn't the hub's", async () => {
    const { send, sent, version } = setup();
    await send.set({ "bambu-studio": "BBL=1" });
    expect(sent).toEqual([]);
    await send.set({ "bambu-studio": null });
    expect(sent).toEqual([
      { path: "/catalog/bambu-studio", entries: ["system", "system/BBL.json"] },
    ]);
    // Sent: the same folder isn't sent again; a slicer update is.
    await send.set({ "bambu-studio": "BBL=1" });
    version("2");
    await send.set({ "bambu-studio": "BBL=1" });
    expect(sent).toHaveLength(2);
    send.stop();
  });

  it("sends nothing for a library it isn't the source of, and stops when the hub says no", async () => {
    const { send, sent } = setup(403, 10);
    await send.set({});
    await send.set({ other: null });
    expect(sent).toEqual([]);
    await send.set({ "bambu-studio": null });
    expect(sent).toHaveLength(1);
    // Refused: dropped, so the next ticks send nothing until the hub names it again.
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
    send.stop();
  });

  it("sends a managed install's folder the hub names, with no slicer found", async () => {
    const { send, sent, dir } = setup(204, 60_000, []);
    const profiles = join(dir, "1.0", "resources", "profiles");
    mkdirSync(join(profiles, "BBL"), { recursive: true });
    writeFileSync(join(profiles, "BBL.json"), JSON.stringify({ version: "7" }));
    await send.set({ "bambu-studio": null });
    expect(sent).toEqual([]);
    await send.set({ "bambu-studio": null }, { "bambu-studio": profiles });
    expect(sent).toEqual([
      { path: "/catalog/bambu-studio", entries: ["system", "system/BBL.json"] },
    ]);
    await send.set({ "bambu-studio": "BBL=7" }, { "bambu-studio": profiles });
    expect(sent).toHaveLength(1);
    send.stop();
  });
});
