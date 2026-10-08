import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dataDir, loadConfig } from "./config.ts";

describe("config", () => {
  it("binds to loopback on 4300 by default", () => {
    expect(loadConfig({})).toMatchObject({ host: "127.0.0.1", port: 4300 });
  });
  it("APP_DATA_DIR overrides the OS default", () => {
    expect(dataDir({ APP_DATA_DIR: "/x" }, "win32")).toBe("/x");
  });
  it("uses XDG on linux", () => {
    expect(dataDir({ XDG_DATA_HOME: "/xdg" }, "linux")).toBe(join("/xdg", "3d-maker-suite"));
  });
});
