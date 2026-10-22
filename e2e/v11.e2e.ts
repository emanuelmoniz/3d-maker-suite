import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, pick, seedPrinter, seedProfile, seedSpool } from "./helpers.ts";

// yazl is the server's dependency (it reads the zips); the tests only borrow it to build one.
const yazl = createRequire(join(import.meta.dirname, "..", "apps", "server", "package.json"))(
  "yazl",
) as typeof import("yazl");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** The block (heading + table + pager) of one section on a page with several tables. */
const block = (page: Page, title: string) =>
  page.locator("section", { has: page.getByRole("heading", { name: title, level: 2 }) }).last();

const zipOf = (files: Record<string, unknown>) =>
  new Promise<Buffer>((resolve) => {
    const z = new yazl.ZipFile();
    for (const [name, data] of Object.entries(files))
      z.addBuffer(Buffer.from(JSON.stringify(data)), name);
    const chunks: Buffer[] = [];
    z.outputStream.on("data", (c: Buffer) => chunks.push(c));
    z.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    z.end();
  });

test("catalog tables page, filter and keep their state in the URL", async ({ page, app }) => {
  for (let i = 1; i <= 30; i++)
    await app.api("POST", "/api/brands", { name: `Brand ${String(i).padStart(2, "0")}` });
  await page.goto("/printers/settings");
  const brands = block(page, "Brands");
  await expect(brands.getByText("1–25 of 30")).toBeVisible();
  await brands.getByRole("button", { name: "Next" }).click();
  await expect(brands.getByText("26–30 of 30")).toBeVisible();
  await expect(page).toHaveURL(/brands\.page=2/);
  await page.reload();
  await expect(block(page, "Brands").getByText("26–30 of 30")).toBeVisible();

  await block(page, "Brands").getByRole("button", { name: "Filter by Name" }).click();
  const popover = page.locator("[popover]:popover-open");
  await popover.getByPlaceholder("Contains").fill("Brand 07");
  await popover.getByRole("button", { name: "Apply" }).click();
  await expect(block(page, "Brands").getByText("1–1 of 1")).toBeVisible();
  await expect(block(page, "Brands").getByRole("link", { name: "Brand 07" })).toBeVisible();
});

test("the back link returns to the parent page", async ({ page, app }) => {
  const printer = await seedPrinter(app.api);
  await page.goto(`/printers/${printer.id}`);
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/printers$/);
  await page.goto("/printers/brands/new");
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/printers\/settings$/);
});

test("branding: app name, logo and favicon", async ({ page }) => {
  await page.goto("/settings");
  const name = page.getByLabel("App name");
  await name.fill("Print Farm");
  await name.blur();
  await expect(page).toHaveTitle(/Print Farm/);
  const logo = page.locator("input[type=file]").first();
  await logo.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("img", { name: "Current logo" })).toBeVisible();
  await expect(
    page.getByRole("complementary").getByRole("img", { name: "Print Farm" }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveTitle(/Print Farm/);
  await page.getByRole("button", { name: "Reset to default" }).first().click();
  await expect(page.getByRole("img", { name: "Current logo" })).toHaveCount(0);
});

test("maintenance task for models and a specific printer shows on each matching printer", async ({
  page,
  app,
}) => {
  const a = await seedPrinter(app.api, "Alpha");
  const other = await app.api<{ id: string }>("POST", "/api/printer-models", {
    brandId: (await app.api<{ items: { id: string }[] }>("GET", "/api/brands")).items[0]?.id,
    model: "Z9",
  });
  await app.api("POST", "/api/printers", { name: "Beta", modelId: other.id, state: "working" });
  await app.api("POST", "/api/printers", { name: "Gamma", modelId: other.id, state: "working" });
  expect(a.id).toBeTruthy();

  await page.goto("/maintenance/new");
  await page.getByLabel("Name", { exact: true }).fill("Lube rods");
  await page.getByLabel("Every (days)").fill("30");
  await page.getByLabel("Only for models").fill("X1");
  await page.getByRole("button", { name: /Acme X1/ }).click();
  await page.getByLabel("Only for printers").fill("Beta");
  await page.getByRole("button", { name: "Beta" }).click();
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page).toHaveURL(/\/maintenance$/);
  const due = page.getByRole("table", { name: "Maintenance due" });
  await expect(due.getByRole("cell", { name: "Alpha" })).toBeVisible();
  await expect(due.getByRole("cell", { name: "Beta" })).toBeVisible();
  await expect(due.getByRole("cell", { name: "Gamma" })).toHaveCount(0);
});

test("printer model and machine profile: create, edit and delete", async ({ page, app }) => {
  await app.api("POST", "/api/brands", { name: "Acme" });
  await page.goto("/printers/models/new");
  await pick(page.getByLabel("Brand"), "Acme");
  await page.getByLabel("Model", { exact: true }).fill("Q1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(block(page, "Printer models").getByRole("link", { name: "Acme Q1" })).toBeVisible();

  await page.getByRole("link", { name: "Add profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Q1 0.4");
  await pick(page.getByLabel("Printer model"), "Q1");
  await page.getByLabel("Nozzle diameter (mm)").fill("0.4");
  await page.getByRole("button", { name: "Save" }).click();
  const profiles = block(page, "Machine profiles");
  await expect(profiles.getByRole("link", { name: "Q1 0.4" })).toBeVisible();

  await profiles.getByRole("link", { name: "Q1 0.4" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Q1 0.6");
  await page.getByLabel("Nozzle diameter (mm)").fill("0.6");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(block(page, "Machine profiles").getByRole("link", { name: "Q1 0.6" })).toBeVisible();

  await block(page, "Machine profiles").getByRole("link", { name: "Q1 0.6" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(block(page, "Machine profiles").getByText("No results")).toBeVisible();
});

test("filament profile: pick or add a brand and a material inline", async ({ page, app }) => {
  await app.api("POST", "/api/filament-brands", { name: "Acme" });
  await page.goto("/filament/profiles/new");
  await pick(page.getByLabel("Brand", { exact: true }), "Acme");
  await page.getByRole("button", { name: "Add material" }).click();
  await page.getByLabel("Add material").fill("PETG");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel("Material", { exact: true })).toHaveValue(/.+/);
  await page.getByLabel("Name", { exact: true }).fill("Tough");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/\/filament\/settings$/);
  const list = await app.api<{ items: { name: string }[] }>("GET", "/api/filament/profiles");
  expect(list.items.map((p) => p.name)).toContain("Tough");
});

test("an archived profile leaves the list but stays on its spool", async ({ page, app }) => {
  const spool = await seedSpool(app.api);
  const { items } = await app.api<{ items: { id: string }[] }>("GET", "/api/filament/profiles");
  await page.goto(`/filament/profiles/${items[0]?.id}`);
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
  await page.goto("/filament/settings");
  await expect(page.getByRole("table", { name: "Filament profiles" })).not.toContainText("Basic");
  await page.goto(`/filament/spools/${spool.id}`);
  await expect(page.getByText("Basic").first()).toBeVisible();
});

test("integrations hub groups cloud and local and edits the per-type policy", async ({
  page,
  app,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "orca-"));
  await app.api("POST", "/api/integrations", { adapterId: "mock", secrets: { token: "t" } });
  await app.api("POST", "/api/integrations", { adapterId: "orca-slicer" });
  const list = await app.api<{ id: string; adapterId: string }[]>("GET", "/api/integrations");
  const orca = list.find((i) => i.adapterId === "orca-slicer");
  await app.api("PATCH", `/api/integrations/${orca?.id}`, { slicerConfigDir: dir });

  await page.goto("/integrations");
  await expect(page.getByRole("heading", { name: "Cloud", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Local", level: 2 })).toBeVisible();
  const mode = page.getByLabel("Mode: Print history");
  await pick(mode, "Manual");
  await expect(page.getByLabel("Frequency: Print history")).toBeDisabled();
  await pick(mode, "Automatic");
  await expect(page.getByLabel("Frequency: Print history")).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Mode: Print history")).toHaveValue("Automatic");
  await pick(page.getByLabel("Mode: Print history"), "Off");
  await expect(page.getByLabel("Frequency: Print history")).toBeDisabled();
});

test("import: template download, XLSX upload, bulk action, apply and export round trip", async ({
  page,
  app,
}) => {
  await seedSpool(app.api, 800);
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Export", exact: true })).toBeVisible();
  const [template] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download template" }).click(),
  ]);
  expect(template.suggestedFilename()).toBe("Spools template.xlsx");

  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const file = join(mkdtempSync(join(tmpdir(), "3dms-xlsx-")), "spools.xlsx");
  await exported.saveAs(file);

  // The file we just exported matches what is in the database.
  await page.getByLabel("Upload a file").setInputFiles(file);
  await expect(page.getByRole("button", { name: "Identical (1)" })).toBeVisible();

  // Same file, but bulk: import everything as new.
  await pick(
    page.getByRole("group", { name: "Bulk operations" }).getByRole("combobox", { name: "Action" }),
    "Import all as new",
  );
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 1 created, 0 updated.")).toBeVisible();
  const spools = await app.api<{ items: unknown[] }>("GET", "/api/filament/spools");
  expect(spools.items).toHaveLength(2);
});

test("import a slicer catalog from a zip, then a changed preset archives the used profile", async ({
  page,
  app,
}) => {
  const preset = (temp: string) => ({
    "user/default/filament/Mine.json": {
      name: "Mine",
      filament_type: ["PETG"],
      filament_vendor: ["Acme"],
      nozzle_temperature: [temp],
    },
  });
  const importZip = async (temp: string) => {
    await page.goto("/import/slicer-zip");
    await page.locator("input[type=file]").setInputFiles({
      name: "orca.zip",
      mimeType: "application/zip",
      buffer: await zipOf(preset(temp)),
    });
    await page.getByRole("link", { name: "Filament profiles" }).click();
    await page.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Import \d+ rows?$/ })
      .click();
    await expect(page.getByText(/Import finished: 1 created/)).toBeVisible();
  };
  await importZip("230");
  const first = await app.api<{ items: { id: string; name: string }[] }>(
    "GET",
    "/api/filament/profiles",
  );
  expect(first.items.map((p) => p.name)).toEqual(["Mine"]);
  await app.api("POST", "/api/filament/spools", {
    profileId: first.items[0]?.id,
    colorHex: "#00ff00",
    initialGrams: 500,
  });

  await page.goto("/import/slicer-zip");
  await page.locator("input[type=file]").setInputFiles({
    name: "orca.zip",
    mimeType: "application/zip",
    buffer: await zipOf(preset("250")),
  });
  await page.getByRole("link", { name: "Filament profiles" }).click();
  await expect(page.getByRole("button", { name: "Changed (1)" })).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Import \d+ rows?$/ })
    .click();
  await expect(page.getByText(/Import finished/)).toBeVisible();

  const active = await app.api<{ items: { id: string }[] }>("GET", "/api/filament/profiles");
  const all = await app.api<{ items: { id: string }[] }>(
    "GET",
    "/api/filament/profiles?archived=true",
  );
  expect(active.items).toHaveLength(1);
  expect(active.items[0]?.id).not.toBe(first.items[0]?.id);
  expect(all.items).toHaveLength(1); // the old version, kept for the spool
});

test.describe("new pages fit every viewport", () => {
  for (const width of [375, 768, 1440]) {
    test(`no horizontal scroll at ${width}px`, async ({ page, app }) => {
      await seedPrinter(app.api);
      await seedProfile(app.api);
      await app.api("POST", "/api/integrations", { adapterId: "mock", secrets: { token: "t" } });
      await page.setViewportSize({ width, height: 900 });
      const bad: string[] = [];
      for (const route of [
        "/printers",
        "/filament",
        "/integrations",
        "/integrations/new",
        "/import/slicer-zip",
        "/printers/profiles/new",
        "/maintenance/new",
        "/filament/profiles/new",
      ]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        if (await hasHorizontalScroll(page)) bad.push(route);
      }
      expect(bad).toEqual([]);
    });
  }
});
