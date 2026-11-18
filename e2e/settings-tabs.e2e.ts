import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const PASSWORD = "correct horse";
// The seeded Viewer role (migration 0086).
const VIEWER = "00000000-0000-4000-8000-000000000003";

const tabs = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });

/** The admin, signed in, with the hub and logging on so that every tab shows. */
const asAdmin = async (page: Page) => {
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: PASSWORD },
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true, logActive: true } });
};

const ALL_TABS = [
  "General",
  "Hub management",
  "Integrations",
  "Users",
  "Roles",
  "Catalog",
  "Data",
  "Logs",
];

test("settings tabs: each opens at its address, and the sidebar has none of them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await asAdmin(page);
  await page.goto("/settings");
  await expect(tabs(page).getByRole("link")).toHaveText(ALL_TABS);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");

  for (const [name, path] of [
    ["Hub management", /\/settings\/hub$/],
    ["Integrations", /\/settings\/integrations$/],
    ["Users", /\/settings\/users$/],
    ["Roles", /\/settings\/roles$/],
    ["Catalog", /\/settings\/catalog\/printers$/],
    ["Data", /\/settings\/data\/import$/],
    ["Logs", /\/settings\/logs$/],
  ] as const) {
    const tab = tabs(page).getByRole("link", { name, exact: true });
    await tab.click();
    await expect(page).toHaveURL(path);
    await expect(tab).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  }

  const side = page.getByRole("complementary");
  for (const name of ["Hub management", "Integrations", "Catalog", "Import | Export", "Logs"])
    await expect(side.getByRole("link", { name })).toHaveCount(0);
  await expect(side.getByRole("link", { name: "Settings" })).toBeVisible();

  // A tab's sub-page keeps its address and goes back to its tab.
  await page.goto("/integrations/new");
  await expect(side.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "data-status",
    "active",
  );
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/settings\/integrations$/);
});

test("settings tabs: old addresses land on their tab with search and hash", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await asAdmin(page);
  for (const [from, to] of [
    ["/hub", "/settings/hub"],
    ["/integrations", "/settings/integrations"],
    ["/integrations?via=abc#bambu-studio", "/settings/integrations?via=abc#bambu-studio"],
    ["/catalog", "/settings/catalog/printers"],
    ["/catalog#filament-presets", "/settings/catalog/filament#filament-presets"],
    ["/catalog/printers#brands", "/settings/catalog/printers#brands"],
    ["/catalog/filament", "/settings/catalog/filament"],
    ["/import", "/settings/data/import"],
    ["/settings/data", "/settings/data/import"],
    ["/logs", "/settings/logs"],
    ["/users", "/settings/users"],
    ["/users/roles", "/settings/roles"],
  ]) {
    await page.goto(from);
    await expect(page).toHaveURL(to);
    await expect(tabs(page)).toBeVisible();
  }
});

test("settings tabs: a viewer sees only theirs, and a hidden tab's address opens General", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await asAdmin(page);
  await page.request.post("/api/users", {
    data: {
      displayName: "Vic Viewer",
      email: "vic@example.com",
      password: PASSWORD,
      roleId: VIEWER,
    },
  });
  await page.context().clearCookies();
  await page.request.post("/api/auth/login", {
    data: { email: "vic@example.com", password: PASSWORD },
  });

  await page.goto("/settings");
  await expect(tabs(page).getByRole("link", { name: "General" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(tabs(page).getByRole("link")).toHaveText(["General", "Catalog"]);

  for (const path of [
    "/settings/hub",
    "/settings/integrations",
    "/settings/users",
    "/settings/roles",
    "/settings/data/import",
    "/settings/data/export",
    "/settings/logs",
    "/hub",
    "/logs",
  ]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/settings$/);
  }
});

test("settings tabs: work by keyboard and scroll inside their row at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await asAdmin(page);
  await page.goto("/settings/logs");
  const logs = tabs(page).getByRole("link", { name: "Logs" });
  await expect(logs).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  const data = tabs(page).getByRole("link", { name: "Data" });
  await data.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/data\/import$/);
  await expect(data).toHaveAttribute("aria-current", "page");
  await expect(data).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("settings tabs: Data has an Import and an Export tab, with no page title or zip card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await asAdmin(page);
  await page.goto("/settings/data");
  await expect(page).toHaveURL(/\/settings\/data\/import$/);
  const data = page.getByRole("navigation", { name: "Import and export" });
  await expect(data.getByRole("link")).toHaveText(["Import", "Export"]);
  await expect(page.getByRole("region", { name: "Import" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Export" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Import | Export" })).toHaveCount(0);
  await expect(page.getByText("Printer and filament presets from a slicer")).toHaveCount(0);

  await data.getByRole("link", { name: "Export" }).click();
  await expect(page).toHaveURL(/\/settings\/data\/export$/);
  await expect(page.getByRole("region", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Import" })).toHaveCount(0);
});
