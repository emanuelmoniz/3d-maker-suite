import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { insertProfile, seedModel } from "./helpers.ts";

const PASSWORD = "correct horse";

const post = async (page: Page, path: string, data: unknown) => {
  const res = await page.request.post(path, { data });
  expect(res.ok(), `${path} ${res.status()}`).toBe(true);
  return (await res.json()) as { id: string };
};

/** The names of the links in a nav block, in order. */
const linkNames = async (block: ReturnType<Page["locator"]>) =>
  (await block.getByRole("link").allInnerTexts()).map((n) => n.trim()).filter(Boolean);

test("old catalog addresses land on their Catalog tab", async ({ page, app }) => {
  const model = await seedModel(app.api);
  insertProfile(app, "print_profiles", { name: "Fine", printerModelId: model.id });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/printers/settings#print-profiles");
  await expect(page).toHaveURL(/\/catalog\/printers#print-profiles$/);
  await expect(page.getByRole("heading", { name: "Print profiles", level: 2 })).toBeInViewport();
  await page.goto("/filament/settings");
  await expect(page).toHaveURL(/\/catalog\/filament$/);
  const tabs = page.getByRole("navigation", { name: "Catalog sections" });
  await expect(tabs.getByRole("link", { name: "Filament", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Printers → Settings itself stays, for the default printer and the states.
  await page.goto("/printers/settings");
  await expect(page).toHaveURL(/\/printers\/settings$/);
  await expect(page.getByLabel("Default printer")).toBeVisible();
  // Nothing makes a profile any more ("new" is no profile's id).
  for (const path of ["/printers/profiles/new", "/printers/print-profiles/new"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Page not found" }), path).toBeVisible();
  }
  await page.goto("/filament/profiles/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
});

test("the bottom block and the More sheet start with Catalog, Import | Export after Integrations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const bottom = page.getByRole("complementary").locator("div.border-t").first();
  const order = ["Catalog", "Integrations", "Import | Export", "Settings"];
  const side = (await linkNames(bottom)).filter((n) => order.includes(n));
  expect(side).toEqual(order);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More" }).click();
  const sheet = (await linkNames(page.getByRole("dialog"))).filter((n) => order.includes(n));
  expect(sheet).toEqual(order);
});

test("Catalog needs catalog read: not in the menu, and its page sends you home", async ({
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
});
