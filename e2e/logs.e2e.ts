import { expect, test } from "./fixtures.ts";

test("logs: settings in the gear page; off says so; on records entries by module and level", async ({
  page,
  app,
}) => {
  const logsLink = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Logs" });

  // The tab shows while logging is off, with an empty state; General has no Logs section.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 2, name: "Logs" })).toHaveCount(0);
  await logsLink.click();
  await expect(page.getByText("Logging is off")).toBeVisible();

  // Log active is switched on the gear page.
  await page.getByRole("link", { name: "Logs settings" }).click();
  await expect(page).toHaveURL(/\/logs\/settings$/);
  await page.getByLabel("Log active").click();
  await expect(page.getByLabel("Log active")).toBeChecked();

  await app.api("POST", "/api/clients", { name: "Ana", mobile: "911" });
  await app.api("POST", "/api/clients", { name: "Rui", mobile: "911" }).catch(() => {}); // 409 -> warn

  await page.goto("/settings/logs");
  const table = page.getByRole("table", { name: "Logs" });
  await expect(table.getByText("POST /api/clients 201")).toBeVisible();
  const row = (text: string) => table.getByRole("row").filter({ hasText: text });
  await expect(row("POST /api/clients 409")).toContainText("Warning");
  await expect(row("POST /api/clients 201")).toContainText("Clients");

  await page.goto("/logs/settings");
  await page.getByLabel("Log active").click();
  await expect(page.getByLabel("Log active")).not.toBeChecked();
  const before = (await app.api<{ total: number }>("GET", "/api/logs")).total;
  await app.api("POST", "/api/clients", { name: "Eva", mobile: "913" });
  expect((await app.api<{ total: number }>("GET", "/api/logs")).total).toBe(before);
});
