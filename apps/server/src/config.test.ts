import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@3d-maker-suite/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { dataDir, loadConfig, writeSavedConfig } from "./config.ts";

describe("config", () => {
  it("binds to loopback on 4300 by default", () => {
    const APP_DATA_DIR = mkdtempSync(join(tmpdir(), "cfg-"));
    expect(loadConfig({ APP_DATA_DIR }, [])).toMatchObject({ host: "127.0.0.1", port: 4300 });
  });
  it("APP_DATA_DIR overrides the OS default", () => {
    expect(dataDir({ APP_DATA_DIR: "/x" }, "win32")).toBe("/x");
  });
  it("uses XDG on linux", () => {
    expect(dataDir({ XDG_DATA_HOME: "/xdg" }, "linux")).toBe(join("/xdg", "3d-maker-suite"));
  });

  describe("host and port", () => {
    const dir = () => mkdtempSync(join(tmpdir(), "cfg-"));

    it("defaults to 127.0.0.1:4300", () => {
      expect(loadConfig({ APP_DATA_DIR: dir() }, [])).toMatchObject({
        host: "127.0.0.1",
        port: 4300,
        hostSource: "default",
        portSource: "default",
      });
    });
    it("reads the config file", () => {
      const d = dir();
      writeSavedConfig(d, { host: "0.0.0.0", port: 5000 });
      expect(loadConfig({ APP_DATA_DIR: d }, [])).toMatchObject({
        host: "0.0.0.0",
        port: 5000,
        hostSource: "file",
        portSource: "file",
      });
    });
    it("env beats the file, CLI beats env", () => {
      const d = dir();
      writeSavedConfig(d, { port: 5000 });
      const env = { APP_DATA_DIR: d, PORT: "6000", HOST: "10.0.0.2" };
      expect(loadConfig(env, [])).toMatchObject({
        port: 6000,
        portSource: "env",
        host: "10.0.0.2",
      });
      expect(loadConfig(env, ["--port", "7000", "--host=::1"])).toMatchObject({
        port: 7000,
        portSource: "cli",
        host: "::1",
        hostSource: "cli",
      });
    });
    it("rejects ports out of range", () => {
      for (const bad of ["0", "65536", "abc", "4300.5"])
        expect(() => loadConfig({ APP_DATA_DIR: dir() }, ["--port", bad])).toThrow(/Invalid port/);
      expect(() => loadConfig({ APP_DATA_DIR: dir(), PORT: "99999" }, [])).toThrow(/env/);
    });
    it("ignores a damaged config file and unknown flags", () => {
      const d = dir();
      writeSavedConfig(d, { port: 70000 });
      expect(loadConfig({ APP_DATA_DIR: d }, ["--other", "x"])).toMatchObject({ port: 4300 });
    });
    it("keeps the password with a non-loopback host", () => {
      expect(
        loadConfig({ APP_DATA_DIR: dir(), APP_PASSWORD: "pw" }, ["--host", "0.0.0.0"]),
      ).toMatchObject({ host: "0.0.0.0", password: "pw" });
    });
  });

  it("saves host/port through the API without changing the running values", async () => {
    const d = mkdtempSync(join(tmpdir(), "cfg-"));
    const config = loadConfig({ APP_DATA_DIR: d }, []);
    const app = await buildApp(openDb(":memory:"), false, d, { serverConfig: config });
    const patch = (payload: object) =>
      app.inject({ method: "PATCH", url: "/api/server-config", payload });
    expect((await patch({ port: 70000 })).statusCode).toBe(400);
    const res = (await patch({ port: 5000, host: "0.0.0.0" })).json();
    expect(res.saved).toEqual({ host: "0.0.0.0", port: 5000 });
    expect(res.effective).toMatchObject({ port: 4300, portSource: "default" });
    expect((await patch({ port: null })).json().saved).toEqual({ host: "0.0.0.0" });
  });
});
