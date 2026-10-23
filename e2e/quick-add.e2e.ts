import { expect, test } from "./fixtures.ts";
import { pick, seedModel, seedPrinter, seedProfile, seedProject } from "./helpers.ts";

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

test("machine profile page: add a model from the model picker", async ({ page, app }) => {
  await seedModel(app.api);
  await page.goto("/printers/profiles/new");
  await page.getByRole("button", { name: "Add model" }).click();
  const dialog = page.getByRole("dialog", { name: "Add printer model" });
  await pick(dialog.getByLabel("Brand"), "Acme");
  await dialog.getByLabel("Model", { exact: true }).fill("Q9");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Printer model")).toHaveValue("Q9");
});

test("printer form: add a print profile for the picked model", async ({ page, app }) => {
  await seedModel(app.api);
  await page.goto("/printers/new");
  await pick(page.getByLabel("Model", { exact: true }), "X1");
  await page.getByRole("button", { name: "Add print profile" }).click();
  const dialog = page.getByRole("dialog", { name: "Add print profile" });
  await expect(dialog.getByLabel("Printer model")).toHaveValue("X1");
  await dialog.getByLabel("Name", { exact: true }).fill("Fine");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Default print profile")).toHaveValue("Fine");
  await expect(page).toHaveURL(/\/printers\/new$/);
});

test("print form: add a machine profile and a spool", async ({ page, app }) => {
  await seedPrinter(app.api);
  await seedProject(app.api);
  await seedProfile(app.api);
  await page.goto("/prints/new");

  await page.getByRole("button", { name: "Add profile" }).click();
  const profile = page.getByRole("dialog", { name: "Add machine profile" });
  await expect(profile.getByLabel("Printer model")).toHaveValue("X1");
  await profile.getByLabel("Name", { exact: true }).fill("X1 0.4");
  await profile.getByRole("button", { name: "Save" }).click();
  await expect(profile).toBeHidden();
  await expect(page.getByLabel("Machine profile")).toHaveValue("X1 0.4");

  await page.getByRole("button", { name: "Add spool" }).click();
  await page.getByRole("button", { name: "New spool" }).click();
  const spool = page.getByRole("dialog", { name: "Add spool" });
  await spool.getByLabel("Color name").fill("Teal");
  await spool.getByRole("button", { name: "Save spool" }).click();
  await expect(spool).toBeHidden();
  await expect(page.getByLabel("Spool", { exact: true })).toHaveValue(/Teal/);
  await expect(page).toHaveURL(/\/prints\/new$/);
});

test("spool form: add a profile with a new brand and material", async ({ page, app }) => {
  await seedProfile(app.api);
  await page.goto("/filament/spools/new");
  await page.getByRole("button", { name: "Add profile" }).click();
  const profile = page.getByRole("dialog", { name: "Add filament profile" });

  await profile.getByRole("button", { name: "Add brand" }).click();
  const brand = page.getByRole("dialog", { name: "Add filament brand" });
  await brand.getByLabel("Name", { exact: true }).fill("Zeta");
  await brand.getByRole("button", { name: "Save" }).click();
  await expect(brand).toBeHidden();
  await expect(profile.getByLabel("Brand")).toHaveValue("Zeta");

  await profile.getByRole("button", { name: "Add material" }).click();
  const material = page.getByRole("dialog", { name: "Add filament material" });
  await material.getByLabel("Name", { exact: true }).fill("PETG");
  await material.getByLabel("Density (g/cm³)").fill("1.27");
  await material.getByRole("button", { name: "Save" }).click();
  await expect(material).toBeHidden();
  await expect(profile.getByLabel("Material")).toHaveValue("PETG");
  await expect(profile.getByLabel("Density (g/cm³)")).toHaveValue("1.27"); // the material's default

  await profile.getByLabel("Name", { exact: true }).fill("Tough");
  await profile.getByRole("button", { name: "Save profile" }).click();
  await expect(profile).toBeHidden();
  await expect(page.getByLabel("Profile", { exact: true })).toHaveValue("Tough");
  await expect(page).toHaveURL(/\/filament\/spools\/new$/);
});
