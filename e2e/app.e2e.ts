import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, ROUTES, seedPrinter, seedSpool } from "./helpers.ts";

test("settings persist across a reload", async ({ page }) => {
  await page.goto("/settings");
  const currency = page.getByLabel("Currency");
  await currency.fill("usd");
  await currency.blur();
  await expect(currency).toHaveValue("USD");
  await page.reload();
  await expect(page.getByLabel("Currency")).toHaveValue("USD");
});

test("add a brand, a model and a printer of that model", async ({ page }) => {
  await page.goto("/printers");
  await page.getByRole("link", { name: "Add brand" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Bambu Lab");
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("link", { name: "Add model" }).click();
  await page.getByLabel("Model", { exact: true }).fill("A1");
  await page.getByLabel("Typical power (W)").fill("95");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Bambu Lab A1" })).toBeVisible();

  await page.getByRole("link", { name: "Add printer" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Bambu A1");
  await page.getByLabel("Model", { exact: true }).selectOption({ label: "A1" });
  await expect(page.getByLabel("Typical power (W)")).toHaveValue("95"); // from the model
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Bambu A1" })).toBeVisible();
  await expect(page.getByText("Bambu Lab A1")).toBeVisible();
});

test("add a spool", async ({ page, app }) => {
  await app.api("POST", "/api/filament/profiles", {
    brand: "Acme",
    material: "PLA",
    densityGcm3: 1.24,
    name: "Basic",
  });
  await page.goto("/filament/spools/new");
  await page.getByLabel("Remaining weight (g)").fill("750");
  await page.getByRole("button", { name: "Save spool" }).click();
  await expect(page).toHaveURL(/\/filament$/);
  await expect(page.getByText("750").first()).toBeVisible();
});

test("a manual print deducts filament from the spool", async ({ page, app }) => {
  await seedPrinter(app.api);
  const spool = await seedSpool(app.api, 1000);
  await page.goto("/prints/new");
  await page.getByLabel("Name", { exact: true }).fill("Benchy");
  await page.getByRole("button", { name: "Add spool" }).click();
  await page.getByLabel("Spool", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Grams").fill("100");
  await page.getByRole("button", { name: "Save print" }).click();
  await expect(page).toHaveURL(/\/prints$/);
  await expect(page.getByText("Benchy")).toBeVisible();
  const after = await app.api<{ remainingGrams: number }>(
    "GET",
    `/api/filament/spools/${spool.id}`,
  );
  expect(after.remainingGrams).toBe(900);
});

test("tables link to the show page, which holds Edit; filters live in the URL", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const base = { printerId: printer.id, startedAt: new Date().toISOString(), usages: [] };
  await app.api("POST", "/api/prints", { ...base, title: "Benchy", outcome: "success" });
  await app.api("POST", "/api/prints", { ...base, title: "Vase", outcome: "failed" });
  await page.goto("/prints?outcome=failed");
  const table = page.getByRole("table", { name: "Prints" });
  await expect(table.getByRole("link", { name: "Benchy" })).toHaveCount(0);
  await expect(table.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await table.getByRole("link", { name: "Vase" }).click();
  await expect(page.getByRole("heading", { name: "Vase", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/prints\/[^/]+\/edit$/);
});

test("scanning project folders lists the projects", async ({ page, app }) => {
  const root = app.makeProjectDir("Dragon");
  await app.api("PATCH", "/api/preferences", { projectRoots: [root] });
  await page.goto("/projects");
  await page.getByRole("button", { name: "Scan folders" }).click();
  await expect(page.getByText("Dragon").first()).toBeVisible();
});

test("stats can be filtered by outcome", async ({ page, app }) => {
  const printer = await seedPrinter(app.api);
  const base = { printerId: printer.id, startedAt: new Date().toISOString(), durationSec: 3600 };
  await app.api("POST", "/api/prints", { ...base, title: "Good", outcome: "success", usages: [] });
  await app.api("POST", "/api/prints", { ...base, title: "Bad", outcome: "failed", usages: [] });
  await page.goto("/stats");
  const prints = page
    .locator("main")
    .getByText("Prints", { exact: true })
    .first()
    .locator("xpath=..");
  await expect(prints).toContainText("2");
  await page.getByRole("combobox", { name: "Outcome" }).selectOption("failed");
  await expect(prints).toContainText("1");
  await expect(prints).not.toContainText("2");
});

test("create and list a backup", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByRole("link", { name: "Download" })).toBeVisible();
});

test("import spools from a CSV after reviewing the rows", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Upload a file").setInputFiles({
    name: "spools.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Brand;Material;Initial weight (g);Purchased\nAcme;PLA;750,5;2026-03-04\nAcme;PLA;abc;\n",
    ),
  });
  await expect(page.getByRole("button", { name: "New (1)" })).toBeVisible();
  await expect(page.getByText("Not a number")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 1 created, 0 updated.")).toBeVisible();
  await page.getByRole("link", { name: "View spools" }).click();
  await expect(page.getByText("750.5").first()).toBeVisible();
});

test.describe("responsive", () => {
  for (const [name, width, height] of [
    ["mobile", 375, 800],
    ["tablet", 768, 1024],
    ["desktop", 1440, 900],
  ] as const) {
    test(`no horizontal scroll at ${name}`, async ({ page, app }) => {
      await seedPrinter(app.api);
      await seedSpool(app.api);
      await page.setViewportSize({ width, height });
      const bad: string[] = [];
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        if (await hasHorizontalScroll(page)) bad.push(route);
      }
      expect(bad).toEqual([]);
    });
  }
});

test("reloading a client-side route serves the app, not a 404", async ({ page }) => {
  await page.goto("/printers");
  await expect(page.getByRole("heading", { name: "Printers", level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Printers", level: 1 })).toBeVisible();
});

test("mobile: the More sheet reaches secondary pages", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Stats" }).click();
  await expect(page).toHaveURL(/\/stats$/);
});
