import { openDb } from "@3d-maker-suite/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

const app = (access: { host: string; password?: string }) =>
  buildApp(openDb(":memory:"), false, "", { access });
const basic = (s: string) => `Basic ${Buffer.from(s).toString("base64")}`;

describe("access guard", () => {
  it("without a password, only loopback and the bind address are accepted", async () => {
    const a = await app({ host: "192.168.1.5" });
    const status = async (host: string) =>
      (await a.inject({ url: "/api/health", headers: { host } })).statusCode;
    expect(await status("localhost:4300")).toBe(200);
    expect(await status("127.0.0.1:4300")).toBe(200);
    expect(await status("[::1]:4300")).toBe(200);
    expect(await status("192.168.1.5:4300")).toBe(200);
    // DNS rebinding: the browser sends the attacker's name.
    expect(await status("evil.example:4300")).toBe(403);

    const any = await app({ host: "0.0.0.0" });
    expect((await any.inject({ url: "/", headers: { host: "0.0.0.0" } })).statusCode).toBe(403);
  });

  it("with a password, every request needs Basic auth", async () => {
    const a = await app({ host: "0.0.0.0", password: "s3cret:x" });
    const get = (authorization?: string) =>
      a.inject({
        url: "/api/health",
        headers: authorization ? { host: "pc.lan", authorization } : { host: "pc.lan" },
      });
    const missing = await get();
    expect(missing.statusCode).toBe(401);
    expect(missing.headers["www-authenticate"]).toMatch(/^Basic /);
    expect((await get(basic("me:wrong"))).statusCode).toBe(401);
    expect((await get("Bearer s3cret:x")).statusCode).toBe(401);
    expect((await get(basic("anyone:s3cret:x"))).statusCode).toBe(200);
  });
});
