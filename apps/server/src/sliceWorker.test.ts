import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bambuStudioWorkerAdapter } from "@3d-maker-suite/adapter-bambu";
import { openDb, schema } from "@3d-maker-suite/db";
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

const TAG = "v02.08.02.61";
const DMG = "Bambu_Studio_mac-v02.08.02.61-20250901.dmg";
const releases = async () => [
  {
    tag: TAG,
    prerelease: false,
    url: "https://github.com/bambulab/BambuStudio/releases/tag/v02.08.02.61",
    assets: [
      {
        name: "Bambu_Studio_win-v02.08.02.61-20250901.zip",
        size: 9,
        digest: "sha256:a",
        url: "https://dl/win.zip",
      },
      { name: DMG, size: 10, digest: "sha256:b", url: "https://dl/mac.dmg" },
    ],
  },
];

// A listening hub with one paired device whose stream is open, reporting a Mac.
async function live() {
  const db = openDb(":memory:");
  const dataDir = mkdtempSync(join(tmpdir(), "worker-data-"));
  const app = await buildApp(db, { stream: { write: () => true } }, dataDir, {
    adapters: [bambuStudioWorkerAdapter()],
    slicerInstaller: { releases },
  });
  close = async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  };
  const admin = db
    .insert(schema.users)
    .values({ email: "a@x.io", displayName: "admin", role: "admin", passwordHash: hash })
    .returning()
    .get();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: admin.email, password: PW },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });
  await send("PATCH", "/api/preferences", { hubEnabled: true });
  const pair = async () => {
    const { code } = (await send("POST", "/api/hub/pairing-codes", { userId: admin.id })).json();
    return (
      await app.inject({ method: "POST", url: "/api/hub/pair", payload: { code, name: "Mac" } })
    ).json() as { token: string; deviceId: string };
  };
  const { token, deviceId } = await pair();
  const dev = (method: "GET" | "PUT" | "POST", url: string, payload?: object, as = token) =>
    app.inject({
      method,
      url: `/api/hub/device${url}`,
      payload,
      headers: { authorization: `Bearer ${as}` },
    });
  const base = await app.listen({ port: 0, host: "127.0.0.1" });
  const res = await fetch(`${base}/api/hub/events`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-connector-system": JSON.stringify({ platform: "darwin", arch: "arm64" }),
    },
  });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let text = "";
  /** The next request of `type` on the stream: its requestId and data. */
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
  const answer = (requestId: string, body: object) => dev("POST", `/replies/${requestId}`, body);
  return { db, send, dev, next, answer, deviceId, pair, cancel: () => reader.cancel() };
}

it("a device made a worker installs the hub's managed slicer for its system and reports it", async () => {
  const { send, dev, next, answer, deviceId, pair } = await live();
  const worker = (
    await send("POST", "/api/integrations", {
      adapterId: "bambu-studio-worker",
      config: { deviceId, source: "managed" },
    })
  ).json();
  expect(worker).toMatchObject({ kind: "worker", status: "unavailable" });

  // Not a worker yet: nothing goes to the device.
  expect(
    (await send("POST", `/api/integrations/${worker.id}/slicer/install`, { tag: TAG })).json(),
  ).toMatchObject({ error: { code: "not_worker" } });
  expect(
    (await send("PATCH", `/api/hub/devices/${deviceId}`, { sliceWorker: true })).statusCode,
  ).toBe(204);
  expect((await send("GET", "/api/hub/devices")).json()[0].sliceWorker).toBe(true);

  // The device's build: the dmg, not the hub's own.
  const rel = await send("GET", `/api/integrations/${worker.id}/slicer/releases`);
  expect(rel.json()).toEqual([expect.objectContaining({ tag: TAG, size: 10 })]);

  const started = send("POST", `/api/integrations/${worker.id}/slicer/install`, { tag: TAG });
  const ask = await next("slicer.install");
  expect(ask).toMatchObject({
    integrationId: worker.id,
    target: {
      version: "02.08.02.61",
      exe: "BambuStudio.app/Contents/MacOS/BambuStudio",
      asset: { name: DMG, digest: "sha256:b", url: "https://dl/mac.dmg" },
    },
  });
  await answer(ask.requestId, { ok: true, result: null });
  expect((await started).json()).toMatchObject({ state: "running", phase: "download", total: 10 });

  const status = (state: string, extra = {}) => ({
    state,
    phase: state === "running" ? "download" : null,
    tag: null,
    received: 5,
    total: 10,
    error: null,
    detail: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ...extra,
  });
  await dev("PUT", "/slicers/install", { integrationId: worker.id, status: status("running") });
  expect((await send("GET", `/api/integrations/${worker.id}/slicer/install`)).json()).toMatchObject(
    {
      state: "running",
      received: 5,
      tag: TAG,
    },
  );
  // Another device can't report this one's install.
  const other = await pair();
  expect(
    (
      await dev(
        "PUT",
        "/slicers/install",
        { integrationId: worker.id, status: status("done") },
        other.token,
      )
    ).statusCode,
  ).toBe(403);

  const exe = "/Users/me/Library/Application Support/x/slicers/BambuStudio";
  await dev("PUT", "/slicers/install", {
    integrationId: worker.id,
    status: status("done"),
    result: { path: exe, version: "02.08.02.61" },
  });
  expect((await send("GET", `/api/integrations/${worker.id}`)).json()).toMatchObject({
    slicerPath: exe,
    slicerVersion: "02.08.02.61",
  });
  expect((await dev("GET", "/slicers/managed")).json()).toEqual([worker.id]);

  // Remove: the device deletes it, the row forgets it.
  const removed = send("DELETE", `/api/integrations/${worker.id}/slicer`);
  const rm = await next("slicer.remove");
  expect(rm.integrationId).toBe(worker.id);
  await answer(rm.requestId, { ok: true, result: null });
  expect((await removed).statusCode).toBe(204);
  expect((await send("GET", `/api/integrations/${worker.id}`)).json().slicerPath).toBeNull();
});

it("an installed slicer becomes the worker's once it runs there; offline, nothing is sent", async () => {
  const { send, next, answer, deviceId, dev, cancel } = await live();
  await send("PATCH", `/api/hub/devices/${deviceId}`, { sliceWorker: true });
  const worker = (
    await send("POST", "/api/integrations", {
      adapterId: "bambu-studio-worker",
      config: { deviceId, source: "installed" },
    })
  ).json();
  expect((await send("POST", `/api/integrations/${worker.id}/slicer/check`, {})).statusCode).toBe(
    400,
  );

  const checked = send("POST", `/api/integrations/${worker.id}/slicer/check`, {
    slicer: "bambu-studio",
  });
  const ask = await next("slicer.check");
  expect(ask.slicer).toBe("bambu-studio");
  const found = { path: "/Applications/BambuStudio.app", version: "02.08.02.61" };
  await answer(ask.requestId, { ok: true, result: found });
  expect((await checked).json()).toEqual(found);
  expect((await send("GET", `/api/integrations/${worker.id}`)).json()).toMatchObject({
    slicerPath: found.path,
    slicerVersion: found.version,
  });
  // Installed, not managed: nothing of it to keep in the device's data folder.
  expect((await dev("GET", "/slicers/managed")).json()).toEqual([]);

  // A typed path that doesn't start there.
  const typed = send("POST", `/api/integrations/${worker.id}/slicer/check`, {
    path: "/opt/x.AppImage",
  });
  const ask2 = await next("slicer.check");
  await answer(ask2.requestId, { ok: false, code: "smoke_failed" });
  expect((await typed).json()).toMatchObject({ error: { code: "smoke_failed" } });

  // Another device for it: its slicer is picked again.
  await send("PATCH", `/api/integrations/${worker.id}`, {
    config: { deviceId, source: "managed" },
  });
  expect((await send("GET", `/api/integrations/${worker.id}`)).json().slicerPath).toBeNull();

  await cancel();
  let res = await send("POST", `/api/integrations/${worker.id}/slicer/check`, {
    slicer: "bambu-studio",
  });
  for (let i = 0; i < 50 && res.statusCode !== 409; i++) {
    await new Promise((r) => setTimeout(r, 20));
    res = await send("POST", `/api/integrations/${worker.id}/slicer/check`, {
      slicer: "bambu-studio",
    });
  }
  expect(res.json()).toMatchObject({ error: { code: "device_offline" } });
});
