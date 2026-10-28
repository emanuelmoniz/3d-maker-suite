import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createLink } from "./hub.ts";
import { openStore } from "./state.ts";
import { allowed, createStatusPage, t } from "./status.ts";

let dir: string;
let close: () => void;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "status-"));
});
afterEach(() => {
  close?.();
  rmSync(dir, { recursive: true, force: true });
});

/** The page on a free port; `call` sends any Host/Origin (fetch won't set Host). */
const serve = async () => {
  const store = openStore(dir);
  const link = createLink({ store, version: "1.0.0", os: "x" });
  const opened: string[] = [];
  const updater = { state: () => ({ failed: undefined, hubOlder: false, error: undefined }) };
  const syncDir = join(dir, "sync");
  const page = createStatusPage({
    link,
    store,
    updater,
    version: "1.0.0",
    syncDir,
    open: (d) => opened.push(d),
  });
  await new Promise<void>((r) => page.listen(0, "127.0.0.1", r));
  const { port } = page.address() as AddressInfo;
  close = () => page.close();
  const call = (method: string, path: string, headers: Record<string, string> = {}, body = "") =>
    new Promise<{ status: number; body: string; location?: string }>((done, fail) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: { host: `127.0.0.1:${port}`, ...headers },
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            done({ status: res.statusCode ?? 0, body: text, location: res.headers.location }),
          );
        },
      );
      req.on("error", fail);
      req.end(body);
    });
  return { port, call, opened, syncDir, origin: () => `http://127.0.0.1:${port}` };
};

it("only answers its own host, and POSTs only from its own page", () => {
  const h = { host: "127.0.0.1:4301" };
  expect(allowed("GET", h, 4301)).toBe(true);
  expect(allowed("GET", { host: "localhost:4301" }, 4301)).toBe(true);
  expect(allowed("GET", { host: "evil.example:4301" }, 4301)).toBe(false);
  expect(allowed("POST", h, 4301)).toBe(false);
  expect(allowed("POST", { ...h, origin: "https://evil.example" }, 4301)).toBe(false);
  expect(allowed("POST", { ...h, origin: "http://127.0.0.1:4301" }, 4301)).toBe(true);
});

it("answers health, shows the pair form, and refuses a cross-site pair", async () => {
  const s = await serve();
  const health = await s.call("GET", "/api/health");
  expect(JSON.parse(health.body)).toEqual({ status: "ok", version: "1.0.0" });
  expect((await s.call("GET", "/", { host: "attacker.example" })).status).toBe(403);

  const home = await s.call("GET", "/");
  expect(home.body).toContain(t("connector:pair.title"));
  expect(home.body).not.toContain('http-equiv="refresh"');

  const form = "hub=http%3A%2F%2F127.0.0.1%3A1&code=AAAA-AAAA&name=WS";
  const type = { "content-type": "application/x-www-form-urlencoded" };
  expect(
    (await s.call("POST", "/pair", { ...type, origin: "https://evil.example" }, form)).status,
  ).toBe(403);
  // From the page: the hub isn't there, so the form comes back with the error and the typed values.
  const bad = await s.call("POST", "/pair", { ...type, origin: s.origin() }, form);
  expect(bad.status).toBe(400);
  expect(bad.body).toContain(t("connector:pair.errors.unreachable"));
  expect(bad.body).toContain('value="WS"');
});

it("creates and opens the sync folder", async () => {
  const s = await serve();
  const res = await s.call("POST", "/open-folder", { origin: s.origin() });
  expect(res).toMatchObject({ status: 303, location: "/" });
  expect(s.opened).toEqual([s.syncDir]);
});

it("escapes what it fills in", () => {
  expect(t("connector:status.lastError", { error: "<b>&" })).toBe("Last error: &#60;b&#62;&#38;");
});
