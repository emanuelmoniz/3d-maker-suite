import { expect, test } from "./fixtures.ts";
import { seedPrinter } from "./helpers.ts";

test("accessories: create, install, remove, install again, delete a record", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);

  await page.goto("/printers");
  await page.getByRole("link", { name: "Add accessory" }).click();
  await page.getByLabel("Name", { exact: true }).fill("AMS Unit");
  await page.getByLabel("Type", { exact: true }).fill("AMS");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "01-AMS Unit" })).toBeVisible();

  await page.goto(`/printers/${printer.id}`);
  const dialog = page.getByRole("dialog");
  const install = async (date: string) => {
    await page.getByRole("button", { name: "Add accessory" }).click();
    await dialog.getByLabel("Installed on").fill(date);
    await dialog.getByRole("button", { name: "Add" }).click();
  };
  await install("2026-01-10");
  const row = page.getByRole("link", { name: "01-AMS Unit" });
  await expect(row).toBeVisible();

  await page.getByRole("button", { name: "Remove 01-AMS Unit" }).click();
  await dialog.getByLabel("Removed on").fill("2026-01-05");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(dialog.getByRole("alert")).toContainText("can't be before");
  await dialog.getByLabel("Removed on").fill("2026-01-15");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);

  await install("2026-01-12"); // inside the first period
  await expect(dialog.getByRole("alert")).toContainText("during that period");
  await dialog.getByLabel("Installed on").fill("2026-01-20");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(row).toBeVisible();

  // Still on it: archiving the printer is refused.
  await page.getByRole("button", { name: "Archive" }).click();
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("alert")).toContainText("Remove its accessories first");

  await row.click();
  const history = page.getByRole("listitem").filter({ hasText: "01-Test Printer" });
  await expect(history).toHaveCount(2);
  await history.last().getByRole("button", { name: "Delete record" }).click();
  await dialog.getByRole("button", { name: "Delete record" }).click();
  await expect(history).toHaveCount(1);

  // From the accessory page: take it off, then record a past period.
  await page.getByRole("button", { name: "Remove from printer" }).click();
  await dialog.getByLabel("Removed on").fill("2026-01-25");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Not installed")).toBeVisible();
  await page.getByRole("button", { name: "Put on a printer" }).click();
  await dialog.getByLabel("Installed on").fill("2026-01-01");
  await dialog.getByLabel("Removed on").fill("2026-01-05");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(history).toHaveCount(2);
  await expect(page.getByText("Not installed")).toBeVisible();
});
