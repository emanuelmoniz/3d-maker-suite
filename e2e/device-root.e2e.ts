import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll } from "./helpers.ts";

/**
 * A root on a NAS or a server (Plan 6.3.0 Step 5): its connector says what the folder sits on, and
 * the root's list and page tell the user when only the rescan keeps it current, or when it is
 * read-only. The connector is played by the test.
 */
test("a device root on a share says it is only rescanned, and when it is read-only (375px)", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  const me = await (await page.request.get("/api/auth/me")).json();
  const { code } = await (
    await page.request.post("/api/hub/pairing-codes", { data: { userId: me.user.id } })
  ).json();
  const { token, deviceId } = await app.api<{ token: string; deviceId: string }>(
    "POST",
    "/api/hub/pair",
    { code, name: "NAS", os: "linux" },
  );
  const asDevice = (path: string, init: { method: string; body: unknown }) =>
    fetch(`${app.url}/api/hub/device${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(init.body),
    });

  // Online, and answering `fs.list` as a connector does: the folder is there.
  const stream = new AbortController();
  const events = await fetch(`${app.url}/api/hub/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: stream.signal,
  });
  expect(
    (await asDevice("/folders", { method: "PUT", body: [{ path: "/mnt/nas", paused: false }] }))
      .status,
  ).toBe(200);
  const reader = events.body?.getReader();
  const dec = new TextDecoder();
  void (async () => {
    let text = "";
    while (reader) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      text += dec.decode(value, { stream: true });
      const blocks = text.split("\n\n");
      text = blocks.pop() ?? "";
      for (const block of blocks) {
        const id = /"requestId":"([^"]+)"/.exec(block)?.[1];
        const ask = /"type":"fs\.list".*"path":(null|"[^"]*")/.exec(block)?.[1];
        if (!id || ask === undefined) continue;
        const path: string | null = JSON.parse(ask);
        await asDevice(`/replies/${id}`, {
          method: "POST",
          body: { ok: true, result: { path, parent: null, sep: "/", entries: [] } },
        });
      }
    }
  })();

  const created = await page.request.post("/api/roots", {
    data: { path: "/mnt/nas/Models", location: deviceId },
  });
  expect(created.status()).toBe(201);
  const root = await created.json();

  // Its connector indexes it: an SMB share, so no event for changes made elsewhere.
  const index = (mount: { type: string; share: boolean; readOnly: boolean }) =>
    asDevice(`/roots/${root.id}/index`, {
      method: "PUT",
      body: { state: "ok", folders: [], mount },
    });
  expect((await index({ type: "cifs", share: true, readOnly: false })).status).toBe(200);

  await page.goto("/projects/settings");
  const row = page.getByRole("row").filter({ hasText: "Models" });
  await expect(row).toContainText("Rescanned only");
  await expect(row).not.toContainText("Read-only");

  await page.getByRole("link", { name: "Edit /mnt/nas/Models" }).click();
  await expect(page.getByRole("heading", { name: "Models", level: 1 })).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "network share (cifs)" })).toBeVisible();
  // With the rescan off nothing sees a change made elsewhere: the page says so.
  await expect(page.getByRole("alert").filter({ hasText: "Rescan is off" })).toHaveCount(0);
  await page
    .getByRole("switch", { name: "Rescan this folder periodically" })
    .click({ force: true });
  await expect(page.getByRole("alert").filter({ hasText: "Rescan is off" })).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // The share is mounted read-only the next time: its connector says so with the index.
  expect((await index({ type: "cifs", share: true, readOnly: true })).status).toBe(200);
  await page.goto("/projects/settings");
  await expect(row).toContainText("Read-only");
  await row.getByRole("link", { name: "Edit /mnt/nas/Models" }).click();
  await expect(page.getByRole("note").filter({ hasText: "mounted read-only" })).toBeVisible();

  // A local disk: neither badge.
  expect((await index({ type: "ext4", share: false, readOnly: false })).status).toBe(200);
  await page.goto("/projects/settings");
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Rescanned only");
  await expect(row).not.toContainText("Read-only");
  stream.abort();
});
