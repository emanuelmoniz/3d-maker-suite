import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAutostart } from "./autostart.ts";

const CMD = '"C:\\Apps\\node\\nodew.exe" "C:\\Apps\\launcher.mjs"';
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "autostart-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("windows", () => {
  // A fake reg.exe: one Run value, "query" and "delete" fail while it is missing.
  const fake = () => {
    const calls: string[][] = [];
    let value: string | undefined;
    const exec = async (_cmd: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "add") value = args[args.indexOf("/d") + 1];
      else if (value === undefined) throw new Error("not found");
      else if (args[0] === "delete") value = undefined;
    };
    return { calls, exec };
  };

  it("adds and removes the Run value", async () => {
    const { calls, exec } = fake();
    const a = createAutostart(CMD, { platform: "win32", home, exec });
    expect(await a.get()).toBe(false);
    await a.set(true);
    expect(await a.get()).toBe(true);
    expect(calls.find((c) => c[0] === "add")).toContain(CMD);
    await a.set(false);
    expect(await a.get()).toBe(false);
  });

  it("turning off when nothing is registered does not call delete", async () => {
    const { calls, exec } = fake();
    await createAutostart(CMD, { platform: "win32", home, exec }).set(false);
    expect(calls.some((c) => c[0] === "delete")).toBe(false);
  });
});

describe.each([
  ["darwin", join("Library", "LaunchAgents", "com.3dmakersuite.login.plist"), "RunAtLoad"],
  ["linux", join(".config", "autostart", "3d-maker-suite.desktop"), "Exec=/bin/sh -c"],
] as const)("%s", (platform, rel, marker) => {
  it("writes and removes the file", async () => {
    const a = createAutostart(CMD, { platform, home });
    expect(await a.get()).toBe(false);
    await a.set(true);
    expect(await a.get()).toBe(true);
    expect(readFileSync(join(home, rel), "utf8")).toContain(marker);
    await a.set(false);
    expect(existsSync(join(home, rel))).toBe(false);
    await a.set(false); // already off: no error
  });
});

it("escapes the command for the plist and the .desktop file", async () => {
  const cmd = 'a & b "$x" \\y';
  await createAutostart(cmd, { platform: "darwin", home }).set(true);
  expect(
    readFileSync(join(home, "Library/LaunchAgents/com.3dmakersuite.login.plist"), "utf8"),
  ).toContain("a &amp; b");
  await createAutostart(cmd, { platform: "linux", home }).set(true);
  expect(readFileSync(join(home, ".config/autostart/3d-maker-suite.desktop"), "utf8")).toContain(
    'Exec=/bin/sh -c "a & b \\"\\$x\\" \\\\\\\\y"',
  );
});

it("takes the product's name, file and label", async () => {
  const product = { name: "Connector", id: "conn", label: "com.example.conn" };
  await createAutostart(CMD, { ...product, platform: "linux", home }).set(true);
  expect(readFileSync(join(home, ".config/autostart/conn.desktop"), "utf8")).toContain(
    "Name=Connector",
  );
  await createAutostart(CMD, { ...product, platform: "darwin", home }).set(true);
  expect(existsSync(join(home, "Library/LaunchAgents/com.example.conn.plist"))).toBe(true);
});
