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

test("old catalog and Presets addresses land on their Catalog tab and table", async ({
  page,
  app,
}) => {
  const model = await seedModel(app.api);
  insertPreset(app, "process_presets", { name: "Fine", printerModelId: model.id });
  const machine = insertPreset(app, "machine_presets", {
    name: "Q1 0.4",
    printerModelId: model.id,
    nozzleDiameterMm: 0.4,
  });
  // The library is the hub's: without it, its address falls back to Catalog settings.
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/printers/settings#process-presets");
  await expect(page).toHaveURL(/\/catalog\/printers#process-presets$/);
  await expect(page.getByRole("heading", { name: "Process presets", level: 2 })).toBeVisible();
  // ADR-0023: the Presets page and its settings went into Catalog; preset pages stay.
  for (const [from, to] of [
    ["/catalog/printers#filament-presets", "/catalog/filament#filament-presets"],
    ["/catalog/filament#process-presets", "/catalog/printers#process-presets"],
    ["/presets", "/catalog/printers#machine-presets"],
    ["/presets/process", "/catalog/printers#process-presets"],
    ["/presets/filament", "/catalog/filament#filament-presets"],
    [`/printers/machine-presets/${machine.id}`, `/catalog/printer-presets/${machine.id}`],
    [`/printers/machine-profiles/${machine.id}`, `/catalog/printer-presets/${machine.id}`],
    [`/presets/printer/${machine.id}`, `/catalog/printer-presets/${machine.id}`],
    ["/catalog/presets", "/catalog/settings/library"],
    ["/hub/presets", "/catalog/settings/library"],
    ["/presets/settings", "/catalog/settings"],
    ["/presets/settings/library", "/catalog/settings/library"],
    ["/presets/settings/sources", "/catalog/settings/sources"],
    // Preset sources merged into Sources (ADR-0023): a link into a card keeps its anchor.
    ["/catalog/settings/preset-sources#receive-x", "/catalog/settings/sources#receive-x"],
    ["/catalog/sources", "/catalog/settings/sources"],
    ["/presets/printer", "/catalog/printers#machine-presets"],
  ]) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to}$`));
  }
  // Printers holds its four tables, each one a jump away.
  const jump = page.getByRole("navigation", { name: "Tables on this tab" });
  await expect(jump.getByRole("link")).toHaveText([
    "Brands",
    "Printer models",
    "Printer presets",
    "Process presets",
  ]);
  for (const name of ["Brands", "Printer models", "Printer presets", "Process presets"])
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "Q1 0.4" }).click();
  await expect(page).toHaveURL(`/catalog/printer-presets/${machine.id}`);
  await expect(page.getByRole("heading", { name: "Q1 0.4", level: 1 })).toBeVisible();
  // A preset's page is in Catalog: its menu item is the current one.
  await expect(
    page.getByRole("complementary").getByRole("link", { name: "Catalog" }),
  ).toHaveAttribute("data-status", "active");
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
  await expect(
    page.getByRole("navigation", { name: "Tables on this tab" }).getByRole("link"),
  ).toHaveText(["Filament brands", "Filament materials", "Filament presets"]);
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

test("the bottom block and the More sheet: Integrations, Catalog, Import | Export, no Presets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const bottom = page.getByRole("complementary").locator("div.border-t").first();
  const order = ["Integrations", "Catalog", "Import | Export", "Settings"];
  const side = (await linkNames(bottom)).filter((n) => [...order, "Presets"].includes(n));
  expect(side).toEqual(order);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More" }).click();
  const sheet = (await linkNames(page.getByRole("dialog"))).filter((n) =>
    [...order, "Presets"].includes(n),
  );
  expect(sheet).toEqual(order);
});

test("Catalog needs its read: not in the menu, and its page sends you home", async ({ page }) => {
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
  // An old Presets link goes through Catalog, so home too.
  await page.goto("/presets/printer");
  await expect(page).toHaveURL(/\/$/);
});
