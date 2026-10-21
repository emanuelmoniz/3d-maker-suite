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
    .getByRole("link", { name: /Clean nozzle/ })
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
  await page.getByRole("link", { name: /Clean nozzle/ }).click();
  await page.getByRole("button", { name: "Postpone 7 days" }).click();
  await expect(page).toHaveURL(/\/alerts$/);
  // Snoozed alerts leave "needs attention" and wait in the history; the snooze can be removed.
  await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: /Clean nozzle/ });
  await expect(row.getByRole("cell", { name: "Snoozed" })).toBeVisible();
  await row.getByRole("button", { name: "Remove snooze" }).click();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: /Clean nozzle/ })).toHaveCount(0);
});

test("integration alert: a sync's log and a link to the integration", async ({ page, app }) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await page.goto("/alerts");
  await page.getByRole("link", { name: /synced/ }).click();
  await expect(page.getByText(/^New: /)).toBeVisible();
  // The counts are in the alert, not in its title.
  await expect(page.locator("dd", { hasText: /^\d+ new, \d+ updated$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open integration" })).toBeVisible();
});

test("success alert: opening reads it, a read success moves to the history, unread brings it back", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await page.goto("/alerts");
  await expect(page.getByTitle("Unread")).toBeVisible();

  await page.getByRole("link", { name: /synced/ }).click();
  await expect(page.locator("dd", { hasText: /^Read$/ })).toBeVisible();
  // Unread sticks: opening does not read it again.
  await page.getByRole("button", { name: "Mark as unread" }).click();
  await expect(page.locator("dd", { hasText: /^Unread$/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark as read" }).click();
  await expect(page.locator("dd", { hasText: /^Read$/ })).toBeVisible();

  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "All clear" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: /synced/ });
  await expect(row.getByRole("cell", { name: "Read", exact: true })).toBeVisible();
  // The table has no read button: unread is done from the alert itself.
  await expect(row.getByRole("button")).toHaveCount(0);
  await row.getByRole("link").click();
  await page.getByRole("button", { name: "Mark as unread" }).click();
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: /synced/ })).toHaveCount(0);
});
