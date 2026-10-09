import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "branding-"));
  app = await buildApp(openDb(":memory:"), false, dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (kind: string, type: string, payload: string | Buffer = Buffer.from([1, 2, 3])) =>
  app.inject({
    method: "PUT",
    url: `/api/branding/${kind}`,
    headers: { "content-type": type },
    payload,
  });

describe("branding", () => {
  it("logo/favicon: upload, serve, replace, reject, reset", async () => {
    expect((await app.inject("/api/branding")).json()).toEqual({ logo: null, favicon: null });
    expect((await app.inject("/api/branding/logo")).statusCode).toBe(404);

    expect((await put("logo", "image/png")).json().logo).toEqual(expect.any(Number));
    expect((await app.inject("/api/branding/logo")).headers["content-type"]).toBe("image/png");

    // Replacing with another type leaves a single file.
    await put("logo", "image/webp");
    expect((await app.inject("/api/branding/logo")).headers["content-type"]).toBe("image/webp");

    expect((await put("logo", "text/plain", "x")).statusCode).toBe(415);
    expect((await put("logo", "image/png", Buffer.alloc(5 * 1024 * 1024 + 1))).statusCode).toBe(
      413,
    );
    expect((await put("nope", "image/png")).statusCode).toBe(400);

    expect((await app.inject({ method: "DELETE", url: "/api/branding/logo" })).statusCode).toBe(
      204,
    );
    expect((await app.inject("/api/branding")).json().logo).toBeNull();
  });

  it("appName preference defaults to empty and is trimmed", async () => {
    const patch = (appName: string) =>
      app.inject({ method: "PATCH", url: "/api/preferences", payload: { appName } });
    expect((await app.inject("/api/preferences")).json().values.appName).toBe("");
    expect((await patch("  My Farm ")).json().values.appName).toBe("My Farm");
    expect((await patch("x".repeat(61))).statusCode).toBe(400);
  });
});
