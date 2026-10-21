import { expect, test } from "./fixtures.ts";
import { seedModel, seedPrinter } from "./helpers.ts";

test("maintenance alert: open it, mark as done, the alert resolves", async ({ page, app }) => {
  // Bought 8 days ago: 2 of 10 days left is inside the 5-day lead, a task done today is not.
  await app.api("POST", "/api/printers", {
    name: "Test Printer",
    modelId: (await seedModel(app.api)).id,
    state: "working",
    purchasedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
  });
  await app.api("POST", "/api/maintenance/types", {
    name: "Clean nozzle",
    intervalDays: 10,
    warnLeadDays: 5,
  });
  await page.goto("/alerts");
  await page
    .getByRole("listitem")
    .filter({ hasText: /Clean nozzle/ })
    .getByRole("link", { name: "Open alert" })
    .click();

  await expect(page.getByRole("heading", { name: "Alert" })).toBeVisible();
  await expect(page.locator("dd", { hasText: /^Warning$/ })).toBeVisible();
  await expect(page.locator("dd", { hasText: /^Maintenance$/ })).toBeVisible();
  await expect(page.locator("dd", { hasText: /^Clean nozzle$/ })).toBeVisible();

  await page.getByRole("button", { name: "Mark as done" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^Resolved on/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as done" })).toHaveCount(0);
});

test("maintenance alert: postpone hides it from the list", async ({ page, app }) => {
  await seedPrinter(app.api);
  await app.api("POST", "/api/maintenance/types", {
    name: "Clean nozzle",
    intervalDays: 10,
    warnLeadDays: 10,
  });
  await page.goto("/alerts");
  await page.getByRole("link", { name: "Open alert" }).click();
  await page.getByRole("button", { name: "Postpone 7 days" }).click();
  await expect(page).toHaveURL(/\/alerts$/);
  await expect(page.getByRole("heading", { name: "Snoozed" })).toBeVisible();
});

test("integration alert: a sync's log and a link to the integration", async ({ page, app }) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await page.goto("/alerts");
  await page.getByRole("link", { name: "Open alert" }).click();
  await expect(page.getByText(/^New: /)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open integration" })).toBeVisible();
});
