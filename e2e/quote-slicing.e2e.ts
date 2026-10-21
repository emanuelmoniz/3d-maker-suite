import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { pick } from "./helpers.ts";

const fixture = join(import.meta.dirname, "../packages/3mf/fixtures/multi_color.3mf");

test("quote from a project: filled, profile changed, sliced, file added, saved, reopened the same", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  mkdirSync(join(root, "Benchy"), { recursive: true });
  copyFileSync(fixture, join(root, "Benchy", "benchy.3mf"));
  // 1 kW at 1 per kWh: an hour of printing is 1.00 of energy.
  await app.api("PATCH", "/api/preferences", { projectRoots: [root], energyCostPerKwh: 1 });
  const mock = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${mock.id}`, { slicerPath: process.execPath });
  // The printer the fixture was saved for, so the file's own settings slice it.
  const brand = await app.api<{ id: string }>("POST", "/api/brands", { name: "Bambu Lab" });
  const a1 = await app.api<{ id: string }>("POST", "/api/printer-models", {
    brandId: brand.id,
    model: "A1",
  });
  await app.api("POST", "/api/print-profiles", {
    name: "Fine",
    printerModelId: a1.id,
    sourcePreset: "mock:system/Fine",
  });
  const printer = await app.api<{ id: string }>("POST", "/api/printers", {
    name: "Main",
    modelId: a1.id,
    state: "working",
    powerW: 1000,
  });
  await app.api("PATCH", "/api/preferences", { defaultPrinterId: printer.id });
  const project = await app.api<{ id: string; meta: { models: { plates: unknown[] }[] } }>(
    "POST",
    "/api/projects",
    { name: "Benchy", folderPath: join(root, "Benchy") },
  );
  // The project's own setup, sliced: plate 1, 1 h (see `fakeSlice`).
  await app.api("PUT", `/api/projects/${project.id}/slicing`, {
    plates: [{ file: "benchy.3mf", plate: 1, printProfileId: null, filaments: [] }],
  });
  await app.api("POST", `/api/projects/${project.id}/slicing/run`);
  await expect
    .poll(async () => {
      const s = await app.api<{ plates: { result: unknown }[] }>(
        "GET",
        `/api/projects/${project.id}/slicing`,
      );
      return !!s.plates[0]?.result;
    })
    .toBe(true);

  // What the project page shows for one print: the quote made from it must match.
  const block = (title: string) =>
    page.locator("section.grid").filter({ has: page.getByRole("heading", { name: title }) });
  await page.goto(`/projects/${project.id}`);
  const projectUsage = await block("Material usage").textContent();
  const projectCost = await block("Aggregated cost").textContent();
  expect(projectUsage).toContain("Total PLA");

  await page.goto("/quotes/new");
  const cost = page.getByRole("region", { name: "Production cost of one print" });
  const energy = cost.getByText("Energy", { exact: true }).locator("xpath=following-sibling::dd");
  const file = page.getByRole("checkbox", { name: /benchy\.3mf/ });
  await expect(page.getByLabel("Print time (minutes)")).toBeVisible();
  await pick(page.getByRole("combobox", { name: "Project", exact: true }), "001-Benchy");
  await expect(file).toBeChecked();
  await expect(page.getByText(/^1h · \d+ g$/).first()).toBeVisible();
  await expect(energy).toHaveText(/1[.,]00/);
  await expect(block("Material usage")).toHaveText(projectUsage ?? "");
  await expect(block("Aggregated cost")).toHaveText(projectCost ?? "");
  // Plates picked: they are the print, so nothing is typed in by hand.
  await expect(page.getByLabel("Print time (minutes)")).toBeHidden();

  // Unticked and ticked again, unchanged: the project's setup and slice come back.
  await file.uncheck();
  await expect(page.getByLabel("Print time (minutes)")).toBeVisible();
  await file.check();
  await expect(page.getByText(/^1h · \d+ g$/).first()).toBeVisible();
  await expect(page.getByText("Needs slicing", { exact: true })).toHaveCount(0);
  await expect(energy).toHaveText(/1[.,]00/);

  // Another print profile: that plate needs slicing again, and slices 1.5 h.
  await pick(page.getByRole("combobox", { name: /^Print profile for/ }).first(), "Fine");
  await expect(page.getByText("Needs slicing", { exact: true }).first()).toBeVisible();
  await expect(energy).toHaveText(/0[.,]00/);
  await page.getByRole("button", { name: "Slice" }).click();
  await expect(page.getByText("Every plate is sliced and up to date.")).toBeVisible();
  await expect(energy).toHaveText(/1[.,]50/);

  // A .3mf that isn't in the project: its plate 1 adds 1 h.
  await page.getByLabel("Add .3mf files").setInputFiles({
    name: "Second.3mf",
    mimeType: "application/octet-stream",
    buffer: readFileSync(fixture),
  });
  await page.getByRole("checkbox", { name: /Second\.3mf/ }).check();
  await page.getByRole("button", { name: "Slice" }).click();
  await expect(page.getByText("Every plate is sliced and up to date.")).toBeVisible();
  await expect(energy).toHaveText(/2[.,]50/);

  await page.getByLabel("Prints").fill("2");
  await page.getByLabel("Quote name").fill("Benchy x2");
  await page.getByRole("button", { name: "Save quote" }).click();
  const heading = page.getByRole("heading", { name: "001-Benchy x2", level: 1 });
  await expect(heading).toBeVisible();
  const price = page.getByRole("region", { name: "Price" }).locator("dl");
  const saved = { cost: await cost.textContent(), price: await price.textContent() };

  // The list, then the saved quote again: the same numbers, without slicing again.
  await page.getByRole("link", { name: "Back" }).click();
  await page
    .getByRole("table", { name: "Saved quotes" })
    .getByRole("link", { name: "001-Benchy x2" })
    .click();
  await expect(heading).toBeVisible();
  await expect(page.getByLabel("Prints")).toHaveValue("2");
  await expect(cost).toHaveText(saved.cost ?? "");
  await expect(price).toHaveText(saved.price ?? "");
  await expect(page.getByRole("checkbox", { name: /Second\.3mf/ })).toBeChecked();
});

test("quote with nothing picked: saves and reopens", async ({ page }) => {
  await page.goto("/quotes/new");
  await page.getByLabel("Quote name").fill("Blank");
  await page.getByRole("button", { name: "Save quote" }).click();
  const heading = page.getByRole("heading", { name: "001-Blank", level: 1 });
  await expect(heading).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await page
    .getByRole("table", { name: "Saved quotes" })
    .getByRole("link", { name: "001-Blank" })
    .click();
  await expect(heading).toBeVisible();
  await expect(page.getByLabel("Prints")).toHaveValue("1");
  await expect(page.getByLabel("Print time (minutes)")).toBeVisible();
});

test("a quote saved before plates opens with its numbers", async ({ page, app }) => {
  // The calculator's form as it was saved before Step 18.
  const form = {
    printerId: "",
    projectId: "",
    plate: "",
    powerW: 0,
    minutes: 60,
    filaments: [{ label: "PLA", grams: 100, price: 20 }],
    laborHours: 0,
    laborRate: 0,
    failureMarginPct: 0,
    markupPct: 0,
    quantity: 3,
  };
  const cost = { material: 200, energy: 0, wear: 0, maintenance: 0, total: 200, unpricedGrams: 0 };
  const quote = {
    unitCost: 200,
    labor: 0,
    failureMargin: 0,
    subtotal: 200,
    markup: 0,
    unitPrice: 200,
    quantity: 3,
    total: 600,
  };
  const q = await app.api<{ id: string }>("POST", "/api/costs/quotes", {
    name: "Old",
    form,
    cost,
    quote,
  });
  // Old links (the page was "Costs") land on the quote too.
  await page.goto(`/costs?quote=${q.id}`);
  await expect(page).toHaveURL(new RegExp(`/quotes/${q.id}$`));
  await expect(page.getByRole("heading", { name: "001-Old", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Prints")).toHaveValue("3");
  await expect(page.getByLabel("Print time (minutes)")).toHaveValue("60");
  const price = page.getByRole("region", { name: "Price" });
  await expect(price.getByText("Total for 3 prints")).toBeVisible();
  await expect(price.getByRole("definition").last()).toHaveText(/6[.,]00/);
});
