import { expect, test } from "./fixtures.ts";

test("hub: pair a device, rename it, revoke it", async ({ page, app }) => {
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
  await expect(row).toContainText("Ana Admin · win32 · connector 5.0.0");

  await row.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename device" });
  await rename.getByLabel("Name").fill("Laptop");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("Laptop");

  await row.getByRole("button", { name: "Revoke" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Revoke Laptop?" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByText("No devices yet")).toBeVisible();
  expect((await asDevice()).status).toBe(401);
});
