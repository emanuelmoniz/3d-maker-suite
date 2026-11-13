import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { classifyError, testAddress } from "./testAddress.ts";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
});
const serve = async (handler: Parameters<typeof createServer>[1]) => {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};
const json =
  (status: number, body: unknown): Parameters<typeof createServer>[1] =>
  (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };

describe("testAddress", () => {
  it("ok: it answered with this server's startedAt", async () => {
    const url = await serve(json(200, { status: "ok", startedAt: "T1" }));
    expect(await testAddress(url, "T1")).toBe("ok");
  });
  it("otherServer: another startedAt, a redirect, not JSON, or another status", async () => {
    expect(await testAddress(await serve(json(200, { startedAt: "T2" })), "T1")).toBe(
      "otherServer",
    );
    const redirect = await serve((_q, r) => r.writeHead(302, { location: "http://x" }).end());
    expect(await testAddress(redirect, "T1")).toBe("otherServer");
    expect(await testAddress(await serve((_q, r) => r.end("<html>")), "T1")).toBe("otherServer");
    expect(await testAddress(await serve(json(404, {})), "T1")).toBe("otherServer");
  });
  it("hostNotAllowed: 403 forbidden_host, but not any other 403", async () => {
    const guard = await serve(json(403, { error: { code: "forbidden_host" } }));
    expect(await testAddress(guard, "T1")).toBe("hostNotAllowed");
    expect(await testAddress(await serve(json(403, {})), "T1")).toBe("otherServer");
  });
  it("refused: nothing listens", async () => {
    const url = await serve(json(200, {}));
    servers.pop()?.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(await testAddress(url, "T1")).toBe("refused");
  });
  it("timeout: it never answers", async () => {
    const url = await serve(() => {});
    expect(await testAddress(url, "T1", 100)).toBe("timeout");
  });
  it("notFound: the name doesn't resolve", async () => {
    expect(await testAddress("http://nope.invalid", "T1")).toBe("notFound");
  });
});

describe("classifyError", () => {
  const cause = (code: string) => new TypeError("fetch failed", { cause: { code } });
  it("maps connection error codes", () => {
    expect(classifyError(cause("ENOTFOUND"))).toBe("notFound");
    expect(classifyError(cause("DEPTH_ZERO_SELF_SIGNED_CERT"))).toBe("certificate");
    expect(classifyError(cause("ERR_TLS_CERT_ALTNAME_INVALID"))).toBe("certificate");
    expect(classifyError(cause("UND_ERR_CONNECT_TIMEOUT"))).toBe("timeout");
    expect(classifyError(cause("ECONNREFUSED"))).toBe("refused");
  });
});
