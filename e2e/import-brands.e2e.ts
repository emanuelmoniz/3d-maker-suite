import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { pick } from "./helpers.ts";

test("export brands as CSV in Catalog, rename one in the review and import it as an update", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/brands", { name: "Acme" });
  await page.goto("/catalog/printers");
  const brands = page.locator("#brands");
  await brands.getByLabel("Export format for Brands").selectOption("csv");
  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    brands.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(exported.suggestedFilename()).toBe("Brands export.csv");
  const file = join(mkdtempSync(join(tmpdir(), "3dms-csv-")), "brands.csv");
  await exported.saveAs(file);

  await brands.getByRole("link", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/catalog\/import\/brands$/);
  await page.getByLabel("Upload a file").setInputFiles(file);
  await expect(page.getByRole("button", { name: "Identical (1)" })).toBeVisible();
  await page.getByRole("button", { name: /^Edit Name, row 2/ }).click();
  await page.getByRole("combobox", { name: "Name, row 2" }).fill("Acme Labs");
  await page.keyboard.press("Enter");
  await pick(page.getByRole("combobox", { name: "Action for row 2" }), "Update");
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 0 created, 1 updated.")).toBeVisible();
  const brand = await app.api<{ name: string }>("GET", `/api/brands/${id}`);
  expect(brand.name).toBe("Acme Labs");
  await page.getByRole("link", { name: "View the printer catalog" }).click();
  await expect(page).toHaveURL(/\/catalog\/printers$/);
});

test("Import | Export lists no catalog type", async ({ page }) => {
  await page.goto("/import");
  await page.getByRole("combobox", { name: "What to import" }).click();
  await expect(page.getByRole("option", { name: "Spools" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Brands", exact: true })).toHaveCount(0);
});
