import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll } from "./helpers.ts";

const VIEWER = "00000000-0000-4000-8000-000000000003";

test("download as a viewer: a hub root and a device root (375px)", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  const hubDir = join(app.dataDir, "hub-models");
  mkdirSync(hubDir, { recursive: true });
  await page.request.post("/api/roots", { data: { path: hubDir } });
  const vase = await (
    await page.request.post("/api/projects", { data: { name: "Vase", createFolder: true } })
  ).json();
  mkdirSync(join(vase.folderPath, "parts"));
  writeFileSync(join(vase.folderPath, "parts", "lid.stl"), "solid lid");

  // Ana's device, with a device root holding Box (the viewer downloads another user's files).
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
  const asDevice = (path: string, body: unknown) =>
    fetch(`${app.url}/api/hub/device${path}`, {
      method: "PUT",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
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
  const data: Record<string, string> = { "box.stl": "solid box", "parts/foot.stl": "solid foot" };
  await asDevice(`/roots/${deviceRoot}/index`, {
    state: "ok",
    folders: [{ rel: "001_Box", digest: "a" }],
  });
  const folder = await asDevice(`/roots/${deviceRoot}/folders`, {
    rel: "001_Box",
    digest: "a",
    scan: {
      files: Object.entries(data).map(([path, d]) => ({
        path,
        kind: "model",
        size: d.length,
        mtime: 1_700_000_000_000,
      })),
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

  // The connector: online, and sends each file the hub asks for.
  const stream = new AbortController();
  const events = await fetch(`${app.url}/api/hub/events`, {
    headers: { authorization },
    signal: stream.signal,
  });
  void (async () => {
    const reader = (events.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let text = "";
    let seen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      text += dec.decode(value, { stream: true });
      const asks = [
        ...text.matchAll(
          /"type":"fs\.upload","requestId":"([^"]+)","rootId":"[^"]+","rel":"([^"]+)"/g,
        ),
      ];
      for (const [, requestId, rel] of asks.slice(seen)) {
        const body = Buffer.from(data[(rel ?? "").slice("001_Box/".length)] ?? "");
        await fetch(`${app.url}/api/hub/device/files/${requestId}`, {
          method: "PUT",
          headers: {
            authorization,
            "content-type": "application/octet-stream",
            "x-file-sha256": createHash("sha256").update(body).digest("hex"),
          },
          body,
        });
      }
      seen = asks.length;
    }
  })().catch(() => {});

  // The viewer.
  await page.request.post("/api/users", {
    data: { displayName: "Vi", email: "vi@example.com", password: "correct horse", roleId: VIEWER },
  });
  await page.context().clearCookies();
  await page.request.post("/api/auth/login", {
    data: { email: "vi@example.com", password: "correct horse" },
  });
  const { items }: { items: { id: string; name: string }[] } = await (
    await page.request.get("/api/projects")
  ).json();
  const idOf = (name: string) => items.find((i) => i.name === name)?.id;

  const save = async (name: RegExp | string, exact = true) => {
    const got = page.waitForEvent("download");
    await page.getByRole("link", { name, exact }).click();
    return (await got).suggestedFilename();
  };

  // Hub root: nothing to download in the header; the files section has it all.
  await page.goto(`/projects/${idOf("Vase")}`);
  await expect(page.getByRole("heading", { name: "Vase" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Download/ })).toHaveCount(0);
  await page.getByRole("heading", { name: "Files", exact: true }).click();
  await expect(page.getByRole("button", { name: "Upload files" })).toHaveCount(0);
  expect(await save("Download full project folder")).toBe(`${vase.folder.split("/").pop()}.zip`);
  expect(await save("Download parts")).toBe("parts.zip");
  await page.getByRole("button", { name: "parts" }).click();
  expect(await save("Download lid.stl")).toBe("lid.stl");
  expect(await hasHorizontalScroll(page)).toBe(false);

  // Device root: grouped by folder, pulled from the device.
  await page.goto(`/projects/${idOf("Box")}`);
  await page.getByRole("heading", { name: "Files", exact: true }).click();
  expect(await save("Download foot.stl")).toBe("foot.stl");
  expect(await save("Download parts")).toBe("parts.zip");
  expect(await save("Download full project folder")).toBe("001_Box.zip");
  expect(await hasHorizontalScroll(page)).toBe(false);

  // Offline: says when the files can be downloaded.
  stream.abort();
  await expect
    .poll(async () => {
      await page.reload();
      await page.getByRole("heading", { name: "Files", exact: true }).click();
      return page
        .getByText("Files can be downloaded and uploaded once the device is back.")
        .count();
    })
    .toBe(1);
  await expect(page.getByRole("link", { name: /^Download/ })).toHaveCount(0);
  await expect(page.getByText("foot.stl")).toBeVisible();
});
