import { expect, test } from "./fixtures.ts";

test("hub: pair a device, edit it, revoke it", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });

  // Hub management is in the menu only while the hub is on.
  await page.reload();
  const nav = page.getByRole("link", { name: "Hub management" });
  await expect(nav).toHaveCount(0);
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  await page.reload();
  await nav.click();
  await expect(page.getByText("No devices yet")).toBeVisible();

  await page.getByRole("button", { name: "Pair a device" }).click();
  const pair = page.getByRole("dialog", { name: "Pair a device" });
  await pair.getByLabel("User").click();
  await page.getByRole("option", { name: "Ana Admin" }).click();
  await pair.getByRole("button", { name: "Create code" }).click();
  const shown = page.getByRole("dialog").filter({ hasText: "Pairing code" });
  const code = (await shown.getByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/).textContent()) ?? "";
  await shown.getByRole("button", { name: "Done" }).click();

  // What the connector does: no session, only the code.
  const { token } = await app.api<{ token: string }>("POST", "/api/hub/pair", {
    code,
    name: "Desk PC",
    os: "win32",
    connectorVersion: "5.0.0",
  });
  const asDevice = () =>
    fetch(`${app.url}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  expect((await asDevice()).status).toBe(200);
  // Online = its event stream is open, as a running connector holds it.
  const stream = new AbortController();
  const events = await fetch(`${app.url}/api/hub/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: stream.signal,
  });
  expect(events.status).toBe(200);

  await page.reload();
  const row = page.getByRole("list", { name: "Devices" }).getByRole("listitem");
  await expect(row).toContainText("Desk PC");
  await expect(row).toContainText("Online");
  await expect(row).toContainText("User: Ana Admin");
  await expect(row).toContainText("win32 · connector 5.0.0");

  // The card has only the two connector actions; everything else is on the Edit connector page.
  await expect(row.getByRole("button")).toHaveText(["Restart connector", "Revoke"]);
  await row.getByRole("link", { name: "Desk PC" }).click();
  await expect(page.getByRole("heading", { name: "Edit connector: Desk PC" })).toBeVisible();

  // What the connector does with a live request: answer on /replies/:id.
  const reader = events.body?.getReader();
  const dec = new TextDecoder();
  void (async () => {
    let text = "";
    while (reader) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      text += dec.decode(value, { stream: true });
      for (const block of text.split("\n\n")) {
        const id = /"requestId":"([^"]+)"/.exec(block)?.[1];
        if (!id || !block.includes("connector.settings.get")) continue;
        text = "";
        await fetch(`${app.url}/api/hub/device/replies/${id}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ ok: true, result: { port: 4301, autostart: true } }),
        });
      }
    }
  })();
  await expect(page.getByLabel("Status page port")).toHaveValue("4301");
  await expect(page.getByLabel("Start with the computer")).toBeChecked();

  const identity = page.getByRole("region", { name: "Identity" });
  await expect(identity).toContainText("User: Ana Admin");
  // Both pages follow a rename of the user.
  await page.request.patch("/api/auth/me", { data: { displayName: "Ana Renamed" } });
  await page.reload();
  await expect(identity).toContainText("User: Ana Renamed");
  await identity.getByLabel("Name").fill("Laptop");
  await identity.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Edit connector: Laptop" })).toBeVisible();

  // Offline: what needs the connector says so, the hub-side settings stay editable.
  stream.abort();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(
    page.getByText("The connector is offline. This can only be changed").first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(row).toContainText("Laptop");
  await expect(row).toContainText("User: Ana Renamed");
  await expect(row.getByRole("button", { name: "Restart connector" })).toBeDisabled();

  await row.getByRole("button", { name: "Revoke" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Revoke Laptop?" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByText("No devices yet")).toBeVisible();
  expect((await asDevice()).status).toBe(401);
});
