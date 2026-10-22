import { expect, test } from "./fixtures.ts";

test("logs: off hides the menu; on records entries by module and level", async ({ page, app }) => {
  const nav = page.getByRole("complementary").getByRole("navigation");
  const logsLink = page.getByRole("complementary").getByRole("link", { name: "Logs" });

  await page.goto("/settings");
  await expect(nav).toBeVisible();
  await expect(logsLink).toHaveCount(0);

  await page.getByLabel("Log active").click();
  await expect(logsLink).toBeVisible();

  await app.api("POST", "/api/clients", { name: "Ana", mobile: "911" });
  await app.api("POST", "/api/clients", { name: "Rui", mobile: "911" }).catch(() => {}); // 409 -> warn

  await logsLink.click();
  const table = page.getByRole("table", { name: "Logs" });
  await expect(table.getByText("POST /api/clients 201")).toBeVisible();
  const row = (text: string) => table.getByRole("row").filter({ hasText: text });
  await expect(row("POST /api/clients 409")).toContainText("Warning");
  await expect(row("POST /api/clients 201")).toContainText("Clients");

  await page.goto("/settings");
  await page.getByLabel("Log active").click();
  await expect(logsLink).toHaveCount(0);
  const before = (await app.api<{ total: number }>("GET", "/api/logs")).total;
  await app.api("POST", "/api/clients", { name: "Eva", mobile: "913" });
  expect((await app.api<{ total: number }>("GET", "/api/logs")).total).toBe(before);
});
