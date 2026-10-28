import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@3d-maker-suite/db";
import { type Autostart, createAutostart } from "@3d-maker-suite/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import type { Config } from "../config.ts";

const CMD = '"C:\\Apps\\node\\nodew.exe" "C:\\Apps\\launcher.mjs"';
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "autostart-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("routes", () => {
  const build = (autostart?: Autostart) =>
    buildApp(openDb(":memory:"), false, "", {
      serverConfig: { host: "127.0.0.1", port: 4300 } as Config,
      autostart,
    });

  it("reports unsupported without a launch command, and has no write route", async () => {
    const app = await build();
    const res = await app.inject("/api/server-config/autostart");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, supported: false });
    const put = await app.inject({
      method: "PUT",
      url: "/api/server-config/autostart",
      payload: { enabled: true },
    });
    expect(put.statusCode).toBe(404);
  });

  it("reads and toggles", async () => {
    const app = await build(createAutostart(CMD, { platform: "linux", home }));
    const get = async () => (await app.inject("/api/server-config/autostart")).json();
    expect(await get()).toEqual({ enabled: false, supported: true });
    const put = await app.inject({
      method: "PUT",
      url: "/api/server-config/autostart",
      payload: { enabled: true },
    });
    expect(put.json()).toEqual({ enabled: true, supported: true });
    expect(await get()).toEqual({ enabled: true, supported: true });
  });
});
