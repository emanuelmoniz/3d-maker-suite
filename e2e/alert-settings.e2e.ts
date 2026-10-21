import { expect, test } from "./fixtures.ts";
import { seedPrinter, seedSpool } from "./helpers.ts";

const alertRows = (page: import("@playwright/test").Page, text: RegExp) =>
  page.getByRole("listitem").filter({ hasText: text });

test("filament: a spool's own low weight replaces the default; empty follows it", async ({
  page,
  app,
}) => {
  const spool = await seedSpool(app.api);
  await app.api("POST", `/api/filament/spools/${spool.id}/adjust`, {
    kind: "manual",
    remainingGrams: 50,
  });
  await page.goto("/alerts");
  await expect(alertRows(page, /is down to/)).toHaveCount(1);

  await page.goto(`/filament/spools/${spool.id}/edit`);
  await page.getByLabel("Low weight warning (g)").fill("20");
  await page.getByRole("button", { name: "Save spool" }).click();
  await page.goto("/alerts");
  await expect(alertRows(page, /is down to/)).toHaveCount(0);

  await page.goto(`/filament/spools/${spool.id}/edit`);
  await page.getByLabel("Low weight warning (g)").fill("");
  await page.getByRole("button", { name: "Save spool" }).click();
  await page.goto("/alerts");
  await expect(alertRows(page, /is down to/)).toHaveCount(1);
});

test("maintenance: a type's warning can be switched off", async ({ page, app }) => {
  await seedPrinter(app.api);
  const type = await app.api<{ id: string }>("POST", "/api/maintenance/types", {
    name: "Clean nozzle",
    intervalDays: 10,
    warnLeadDays: 10,
  });
  await page.goto("/alerts");
  await expect(alertRows(page, /Clean nozzle is due soon/)).toHaveCount(1);

  await page.goto(`/maintenance/types/${type.id}/edit`);
  await page.getByLabel("Warn before it is due").uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await page.goto("/alerts");
  await expect(alertRows(page, /Clean nozzle/)).toHaveCount(0);
});

test("integrations: a task raises only the severities picked", async ({ page, app }) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await page.goto("/integrations");
  await page.getByRole("checkbox", { name: /Alert on Success: Printers/ }).click(); // saved first, so the box flips after the round trip
  await expect(
    page.getByRole("checkbox", { name: /Alert on Success: Printers/ }),
  ).not.toBeChecked();

  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await page.goto("/alerts");
  await expect(alertRows(page, /synced/)).toHaveCount(0);
});
