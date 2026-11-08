import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bambuStudioAdapter, bambuStudioWorkerAdapter } from "@3d-maker-suite/adapter-bambu";
import { BUILT_IN_ROLE_IDS } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { zipFolder } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { hashPassword } from "./lib/password.ts";

const PW = "password123";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PW);
});
let close: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

/** A worker-only hub: two paired devices that report Bambu Studio, the first one a worker. */
async function hub() {
  const db = openDb(":memory:");
  const dataDir = mkdtempSync(join(tmpdir(), "device-catalog-"));
  const app = await buildApp(db, { stream: { write: () => true } }, dataDir, {
    adapters: [bambuStudioAdapter(), bambuStudioWorkerAdapter()],
  });
  close = async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  };
  const admin = db
    .insert(schema.users)
    .values({
      email: "a@x.io",
      displayName: "admin",
      roleId: BUILT_IN_ROLE_IDS.admin,
      passwordHash: hash,
    })
    .returning()
    .get();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: admin.email, password: PW },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  const send = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });
  await send("PATCH", "/api/preferences", { hubEnabled: true });
  const base = await app.listen({ port: 0, host: "127.0.0.1" });

  const pair = async (name: string) => {
    const { code } = (await send("POST", "/api/hub/pairing-codes", { userId: admin.id })).json();
    const { token, deviceId } = (
      await app.inject({ method: "POST", url: "/api/hub/pair", payload: { code, name } })
    ).json() as { token: string; deviceId: string };
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({
      method: "PUT",
      url: "/api/hub/device/slicers",
      payload: [{ id: "bambu-studio", version: null, path: "x" }],
      headers,
    });
    /** Its `system/` with one vendor at `version`, zipped as the connector sends it. */
    const upload = async (version: string) => {
      const dir = mkdtempSync(join(dataDir, "upload-"));
      writeFileSync(join(dir, "BBL.json"), JSON.stringify({ name: "Bambu Lab", version }));
      mkdirSync(join(dir, "BBL"));
      await zipFolder(dir, join(dir, "..", `${name}.zip`), "system/");
      return app.inject({
        method: "PUT",
        url: "/api/hub/device/catalog/bambu-studio",
        payload: readFileSync(join(dir, "..", `${name}.zip`)),
        headers: { ...headers, "content-type": "application/octet-stream" },
      });
    };
    /** Opens its event stream: the connect's headers, and the next request of a type. */
    const connect = async () => {
      const res = await fetch(`${base}/api/hub/events`, { headers });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      let text = "";
      const next = async (type: string) => {
        for (;;) {
          const at = text.indexOf(`event: ${type}\n`);
          if (at >= 0) {
            const line = text.slice(at).split("\n")[1] ?? "";
            text = text.slice(at + type.length + 8);
            return JSON.parse(line.replace(/^data: /, ""));
          }
          const { done, value } = await reader.read();
          if (done) throw new Error("stream ended");
          text += dec.decode(value, { stream: true });
        }
      };
      const answer = (requestId: string, body: object) =>
        app.inject({
          method: "POST",
          url: `/api/hub/device/replies/${requestId}`,
          payload: body,
          headers,
        });
      return {
        sources: JSON.parse(res.headers.get("x-catalog-sources") ?? "null"),
        next,
        answer,
        close: () => reader.cancel(),
      };
    };
    return { deviceId, upload, connect };
  };

  const ws1 = await pair("WS-1");
  const ws2 = await pair("WS-2");
  const worker = (
    await send("POST", "/api/integrations", {
      adapterId: "bambu-studio-worker",
      config: { deviceId: ws1.deviceId, source: "installed" },
    })
  ).json() as { id: string };
  const fingerprint = () =>
    db.select().from(schema.integrations).where(eq(schema.integrations.id, worker.id)).get()
      ?.catalogFingerprint;
  /** Until the catalog check after an upload has run. */
  const checked = async (want: string) => {
    for (let i = 0; i < 100 && fingerprint() !== want; i++)
      await new Promise((r) => setTimeout(r, 20));
    return fingerprint();
  };
  return { db, dataDir, send, ws1, ws2, worker, checked };
}

it("a worker-only hub gets its catalog from the source device; another device sends nothing", async () => {
  const { dataDir, send, ws1, ws2, worker, checked } = await hub();
  // No row can read a catalog: the first device that reports the slicer is the source.
  const one = await ws1.connect();
  expect(one.sources).toEqual({ "bambu-studio": null });
  const two = await ws2.connect();
  expect(two.sources).toEqual({});

  expect((await ws2.upload("01.00")).json()).toMatchObject({ error: { code: "not_source" } });
  expect((await ws1.upload("01.00")).statusCode).toBe(204);
  const copy = join(dataDir, "slicers", worker.id, "config", "system", "BBL.json");
  expect(JSON.parse(readFileSync(copy, "utf8")).version).toBe("01.00");
  // A first sight is only recorded (ADR-0019); a slicer update is a change for the check.
  expect(await checked("BBL=01.00")).toBe("BBL=01.00");
  expect((await ws1.upload("01.01")).statusCode).toBe(204);
  expect(await checked("BBL=01.01")).toBe("BBL=01.01");

  // Reconnected, it knows the hub has that one: nothing to send.
  await one.close();
  const again = await ws1.connect();
  expect(again.sources).toEqual({ "bambu-studio": "BBL=01.01" });

  // A connector too old for it refuses the pick, which stays as it was.
  const pick = (deviceId: string) => send("PUT", "/api/catalog/sources/bambu-studio", { deviceId });
  const refused = pick(ws2.deviceId);
  const probe = await two.next("catalog.sources");
  await two.answer(probe.requestId, { ok: false, code: "ENOTSUP" });
  expect((await refused).json()).toMatchObject({ error: { code: "device_outdated" } });
  expect((await send("GET", "/api/catalog/sources")).json()[0].source).toMatchObject({
    deviceId: ws1.deviceId,
    picked: false,
  });

  // Picked: the old source is told to stop, the new one to send.
  const picked = pick(ws2.deviceId);
  const ok = await two.next("catalog.sources");
  await two.answer(ok.requestId, { ok: true, result: null });
  const told = async (device: typeof two) => {
    const e = await device.next("catalog.sources");
    await device.answer(e.requestId, { ok: true, result: null });
    return e.libraries;
  };
  expect(await Promise.all([told(again), told(two)])).toEqual([
    {},
    { "bambu-studio": "BBL=01.01" },
  ]);
  expect((await picked).statusCode).toBe(204);
  expect((await ws1.upload("01.02")).json()).toMatchObject({ error: { code: "not_source" } });
  await again.close();
  await two.close();
  // A hub with two paired devices takes a few seconds to build.
}, 20_000);
