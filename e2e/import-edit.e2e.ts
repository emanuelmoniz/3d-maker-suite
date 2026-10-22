import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { pick, seedSpool } from "./helpers.ts";

test("export spools as CSV, upload it, edit a cell in the review and import the edit", async ({
  page,
  app,
}) => {
  const { id } = await seedSpool(app.api, 800);
  await page.goto("/import");
  const exportSection = page.getByRole("region", { name: "Export" });
  await pick(exportSection.getByRole("combobox", { name: "Format" }), "CSV (.csv)");
  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    exportSection.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(exported.suggestedFilename()).toBe("Spools export.csv");
  const file = join(mkdtempSync(join(tmpdir(), "3dms-csv-")), "spools.csv");
  await exported.saveAs(file);

  await page.getByLabel("Upload a file").setInputFiles(file);
  await expect(page.getByRole("button", { name: "Identical (1)" })).toBeVisible();

  // A bad value is caught while typing; Escape drops it.
  await page.getByRole("button", { name: /^Edit Price paid, row 2/ }).click();
  await page.getByRole("textbox", { name: "Price paid, row 2" }).fill("abc");
  await expect(page.getByText("Not a number")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Undo the edit/ })).toHaveCount(0);

  await page.getByRole("button", { name: /^Edit Location, row 2/ }).click();
  await page.getByRole("textbox", { name: "Location, row 2" }).fill("Shelf 2");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Undo the edit of Location, row 2" }),
  ).toBeVisible();

  await pick(page.getByRole("combobox", { name: "Action for row 2" }), "Update");
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 0 created, 1 updated.")).toBeVisible();
  const spool = await app.api<{ location: string | null }>("GET", `/api/filament/spools/${id}`);
  expect(spool.location).toBe("Shelf 2");
});
