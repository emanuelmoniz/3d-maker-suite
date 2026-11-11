import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { insertPreset, seedModel } from "./helpers.ts";

const PASSWORD = "correct horse";

const post = async (page: Page, path: string, data: unknown) => {
  const res = await page.request.post(path, { data });
  expect(res.ok(), `${path} ${res.status()}`).toBe(true);
  return (await res.json()) as { id: string };
};

/** The names of the links in a nav block, in order. */
const linkNames = async (block: ReturnType<Page["locator"]>) =>
  (await block.getByRole("link").allInnerTexts()).map((n) => n.trim()).filter(Boolean);

test("old catalog addresses land on their Catalog or Presets tab", async ({ page, app }) => {
  const model = await seedModel(app.api);
  insertPreset(app, "process_presets", { name: "Fine", printerModelId: model.id });
  const machine = insertPreset(app, "machine_presets", {
    name: "Q1 0.4",
    printerModelId: model.id,
    nozzleDiameterMm: 0.4,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/printers/settings#process-presets");
  await expect(page).toHaveURL(/\/presets\/process$/);
  await expect(page.getByRole("heading", { name: "Process presets", level: 2 })).toBeVisible();
  // ADR-0021: the preset tables, their pages, the library and the sources left Catalog.
  for (const [from, to] of [
    ["/catalog/printers#machine-presets", "/presets/printer"],
    ["/catalog/filament#filament-presets", "/presets/filament"],
    [`/printers/machine-presets/${machine.id}`, `/presets/printer/${machine.id}`],
    [`/printers/machine-profiles/${machine.id}`, `/presets/printer/${machine.id}`],
    ["/catalog/presets", "/presets/settings/library"],
    ["/hub/presets", "/presets/settings/library"],
    ["/catalog/sources", "/catalog/settings/sources"],
    ["/presets", "/presets/printer"],
  ]) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to}$`));
  }
  await expect(page.getByRole("heading", { name: "Printer presets", level: 2 })).toBeVisible();
  const presetTabs = page.getByRole("navigation", { name: "Preset kinds" });
  await expect(presetTabs.getByRole("link", { name: "Printer" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("link", { name: "Q1 0.4" }).click();
  await expect(page).toHaveURL(`/presets/printer/${machine.id}`);
  await expect(page.getByRole("heading", { name: "Q1 0.4", level: 1 })).toBeVisible();
  // Filament settings is its own page now, with General and Sources tabs.
  await page.goto("/filament/settings");
  await expect(page).toHaveURL(/\/filament\/settings$/);
  const settingsTabs = page.getByRole("navigation", { name: "Settings sections" });
  await expect(settingsTabs.getByRole("link", { name: "General" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await settingsTabs.getByRole("link", { name: "Sources" }).click();
  await expect(page).toHaveURL(/\/filament\/settings\/sources$/);
  // No account allows spools: they are added by hand (ADR-0021).
  await expect(page.getByRole("heading", { name: "No sources" })).toBeVisible();
  await page.goto("/catalog/filament");
  const tabs = page.getByRole("navigation", { name: "Catalog sections" });
  await expect(tabs.getByRole("link", { name: "Filament", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Printers → Settings itself stays, for the default printer and the states.
  await page.goto("/printers/settings");
  await expect(page).toHaveURL(/\/printers\/settings$/);
  await expect(page.getByLabel("Default printer")).toBeVisible();
  // Nothing makes a preset any more ("new" is no preset's id).
  await page.goto("/printers/presets/new");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto("/printers/process-presets/new");
  await expect(page.getByRole("alert")).toContainText("Preset not found");
  await page.goto("/filament/presets/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
});

test("the bottom block and the More sheet: Integrations, Catalog, Presets, Import | Export", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const bottom = page.getByRole("complementary").locator("div.border-t").first();
  const order = ["Integrations", "Catalog", "Presets", "Import | Export", "Settings"];
  const side = (await linkNames(bottom)).filter((n) => order.includes(n));
  expect(side).toEqual(order);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More" }).click();
  const sheet = (await linkNames(page.getByRole("dialog"))).filter((n) => order.includes(n));
  expect(sheet).toEqual(order);
});

test("Catalog and Presets need their read: not in the menu, and their page sends you home", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await post(page, "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  const role = await post(page, "/api/roles", {
    name: "Printers only",
    permissions: { printers: "read", catalog: "none" },
  });
  await post(page, "/api/users", {
    displayName: "Pat",
    email: "pat@example.com",
    password: PASSWORD,
    roleId: role.id,
  });
  await page.context().clearCookies();
  await post(page, "/api/auth/login", { email: "pat@example.com", password: PASSWORD });

  await page.goto("/printers");
  await expect(page.getByRole("complementary").getByRole("link", { name: "Catalog" })).toHaveCount(
    0,
  );
  await page.goto("/catalog/printers");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("complementary").getByRole("link", { name: "Presets" })).toHaveCount(
    0,
  );
  await page.goto("/presets/printer");
  await expect(page).toHaveURL(/\/$/);
});
