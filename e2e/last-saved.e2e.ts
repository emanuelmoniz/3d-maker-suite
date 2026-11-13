import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll } from "./helpers.ts";

test("last saved by: a hub root file and a device root file (375px)", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Pereira", email: "ana@example.com", password: "correct horse" },
  });
  // The device receives every hub project folder, so it may save into them.
  await page.request.patch("/api/preferences", {
    data: { hubEnabled: true, hubDefaultSyncMode: "all" },
  });
  const hubDir = join(app.dataDir, "hub-models");
  mkdirSync(hubDir, { recursive: true });
  const root = await (await page.request.post("/api/roots", { data: { path: hubDir } })).json();
  const me = await (await page.request.get("/api/auth/me")).json();
  const { code } = await (
    await page.request.post("/api/hub/pairing-codes", { data: { userId: me.user.id } })
  ).json();
  const { token, deviceId } = await app.api<{ token: string; deviceId: string }>(
    "POST",
    "/api/hub/pair",
    { code, name: "Desk PC", os: "win32" },
  );
  const authorization = `Bearer ${token}`;
  const asDevice = (path: string, method: string, body: unknown) =>
    fetch(`${app.url}/api/hub/device${path}`, {
      method,
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  // Online: a device root's files show only while its device is connected.
  const stream = new AbortController();
  const events = await fetch(`${app.url}/api/hub/events`, {
    headers: { authorization },
    signal: stream.signal,
  });
  void events.body
    ?.getReader()
    .read()
    .catch(() => {});

  // Hub root: the device's save reaches the hub.
  const model = Buffer.from("solid vase");
  const saved = await fetch(
    `${app.url}/api/hub/device/sync/roots/${root.id}/file?path=${encodeURIComponent("Vase/vase.3mf")}&base=0`,
    {
      method: "PUT",
      headers: {
        authorization,
        "content-type": "application/octet-stream",
        "x-file-sha256": createHash("sha256").update(model).digest("hex"),
      },
      body: model,
    },
  );
  expect(saved.status).toBe(200);
  await page.request.post("/api/projects/scan");
  await expect
    .poll(async () => (await (await page.request.get("/api/projects/scan")).json()).state)
    .toBe("idle");

  // Device root: as a shared folder leaves it (no API makes one without a live connector).
  const now = new Date().toISOString();
  const deviceRoot = randomUUID();
  const db = new DatabaseSync(join(app.dataDir, "app.sqlite"), { timeout: 5000 });
  try {
    db.prepare(
      "insert into roots (id, name, location, path, position, created_at, updated_at) values (?, 'WS', ?, 'C:/models', 1, ?, ?)",
    ).run(deviceRoot, deviceId, now, now);
  } finally {
    db.close();
  }
  const index = await asDevice(`/roots/${deviceRoot}/index`, "PUT", {
    state: "ok",
    folders: [{ rel: "001_Box", digest: "a" }],
  });
  expect(index.status).toBe(200);
  const folder = await asDevice(`/roots/${deviceRoot}/folders`, "PUT", {
    rel: "001_Box",
    digest: "a",
    scan: {
      files: [{ path: "box.stl", kind: "model", size: 5, mtime: Date.now() - 3 * 3_600_000 }],
      models: [],
      mainFile: "box.stl",
      sourceUrl: null,
      hasModel: true,
      unreadable: 0,
    },
    texts: {},
    cover: null,
    previews: [],
    gallery: [],
    galleryLeftOut: [],
  });
  expect(folder.status).toBe(204);

  const { items }: { items: { id: string; name: string }[] } = await (
    await page.request.get("/api/projects")
  ).json();
  const label = /Last saved by Ana Pereira on Desk PC, /;
  for (const [name, file] of [
    ["Vase", "vase.3mf"],
    ["Box", "box.stl"],
  ] as const) {
    const p = items.find((i) => i.name === name);
    if (!p) throw new Error(`no ${name} project`);
    await page.goto(`/projects/${p.id}`);
    await page.getByRole("heading", { name: "Files", exact: true }).click();
    const row = page.getByRole("listitem").filter({ hasText: file });
    await expect(row.getByText(label)).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  }
  stream.abort();
});
