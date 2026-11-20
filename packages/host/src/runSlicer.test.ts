import { describe, expect, it } from "vitest";
import { commandArgs } from "./runSlicer.ts";

describe("a slicer started through a command", () => {
  it("gives a Flatpak the work folder and the 3MF's folder, before the app id", () => {
    expect(
      commandArgs("flatpak", ["run", "x.Slicer"], ["--slice", "1"], "/p/a/box.3mf", "/tmp/w"),
    ).toEqual([
      "run",
      "--filesystem=/tmp/w",
      "--filesystem=/p/a:ro",
      "x.Slicer",
      "--slice",
      "1",
      "/p/a/box.3mf",
    ]);
  });

  it("puts any other command's arguments in front of the slicer's own", () => {
    expect(commandArgs("node", ["-e"], ["x"], "f.3mf", "/w")).toEqual(["-e", "x", "f.3mf"]);
  });
});
