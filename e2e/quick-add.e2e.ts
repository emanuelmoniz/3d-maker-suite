import { expect, test } from "./fixtures.ts";
import { pick, seedModel, seedPreset, seedPrinter, seedProject } from "./helpers.ts";

// Every "+ Add …" beside a picker opens a modal; saving there selects the new row in the picker.

test("printer model page: add a brand from the brand picker", async ({ page, app }) => {
  await seedModel(app.api); // brand "Acme", so a missed pick can't fall back to the only brand
  await page.goto("/printers/models/new");
  await page.getByRole("button", { name: "Add brand" }).click();
  const dialog = page.getByRole("dialog", { name: "Add brand" });
  await dialog.getByLabel("Name", { exact: true }).fill("Zeta");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Brand")).toHaveValue("Zeta");
});

test("printer form: add a model from the model picker; presets come only from a slicer", async ({
  page,
  app,
}) => {
  await seedModel(app.api);
  await page.goto("/printers/new");
  await page.getByRole("button", { name: "Add model" }).click();
  const dialog = page.getByRole("dialog", { name: "Add printer model" });
  await pick(dialog.getByLabel("Brand"), "Acme");
  await dialog.getByLabel("Model", { exact: true }).fill("Q9");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("Q9");
  await expect(page.getByLabel("Default process preset")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add process preset" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/printers\/new$/);
});

test("print form: add a spool; no printer preset is made here", async ({ page, app }) => {
  await seedPrinter(app.api);
  await seedProject(app.api);
  await seedPreset(app);
  await page.goto("/prints/new");

  await expect(page.getByLabel("Printer preset")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add preset" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add spool" }).click();
  await page.getByRole("button", { name: "New spool" }).click();
  const spool = page.getByRole("dialog", { name: "Add spool" });
  await pick(spool.getByLabel("Material", { exact: true }), "PLA");
  await spool.getByLabel("Color name").fill("Teal");
  await spool.getByRole("button", { name: "Save spool" }).click();
  await expect(spool).toBeHidden();
  await expect(page.getByLabel("Spool", { exact: true })).toHaveValue(/Teal/);
  await expect(page).toHaveURL(/\/prints\/new$/);
});

test("spool form: add a new brand and material, no preset needed", async ({ page }) => {
  await page.goto("/filament/spools/new");

  await page.getByRole("button", { name: "Add brand" }).click();
  const brand = page.getByRole("dialog", { name: "Add filament brand" });
  await brand.getByLabel("Name", { exact: true }).fill("Zeta");
  await brand.getByRole("button", { name: "Save" }).click();
  await expect(brand).toBeHidden();
  await expect(page.getByLabel("Brand")).toHaveValue("Zeta");

  await page.getByRole("button", { name: "Add material" }).click();
  const material = page.getByRole("dialog", { name: "Add filament material" });
  await material.getByLabel("Name", { exact: true }).fill("PETG");
  await material.getByRole("button", { name: "Save" }).click();
  await expect(material).toBeHidden();
  await expect(page.getByLabel("Material", { exact: true })).toHaveValue("PETG");

  await page.getByLabel("Name", { exact: true }).fill("Tough");
  await page.getByRole("button", { name: "Save spool" }).click();
  await expect(page).toHaveURL(/\/filament(\?|$)/);
  await expect(page.getByText(/Zeta PETG Tough/).first()).toBeVisible();
});
