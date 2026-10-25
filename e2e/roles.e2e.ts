import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const PASSWORD = "correct horse";

const post = async (page: Page, path: string, data: unknown) => {
  const res = await page.request.post(path, { data });
  expect(res.ok(), `${path} ${res.status()}`).toBe(true);
  return (await res.json()) as { id: string };
};

const signInAs = async (page: Page, email: string) => {
  await page.context().clearCookies();
  await post(page, "/api/auth/login", { email, password: PASSWORD });
};

test("roles: viewer and editor see only what they can do; logs show the actor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  // The admin arranges the data and the two accounts.
  await post(page, "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  await page.request.patch("/api/preferences", { data: { logActive: true } });
  for (const [displayName, email, role] of [
    ["Eva Editor", "eva@example.com", "editor"],
    ["Vic Viewer", "vic@example.com", "viewer"],
  ])
    await post(page, "/api/users", { displayName, email, password: PASSWORD, role });
  const { id } = await post(page, "/api/clients", { name: "Acme", mobile: "911" });

  const side = page.getByRole("complementary");
  const seesAdminMenu = async () => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    return (await side.getByRole("link", { name: /^(Import|Integrations|Logs)/ }).count()) > 0;
  };

  // No page asks for an admin-only route, so no 403 and no role banner.
  const browsesCleanly = async () => {
    const denied: string[] = [];
    page.on("response", (r) => r.status() === 403 && denied.push(r.url()));
    for (const path of ["/", "/clients", "/prints", "/settings", "/alerts"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    page.removeAllListeners("response");
    expect(denied).toEqual([]);
    await expect(page.getByText("Your role doesn't allow that")).toHaveCount(0);
  };

  // Settings: non-admins get display keys, theme and account only.
  const settingsSections = async () => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
    return page.getByRole("heading", { level: 2 }).allTextContents();
  };
  const adminOnly = ["Branding", "Network", "Backup & export", "Logs", "About & updates"];

  // Printer, accessory and module setup is admin-only: no add links, no settings gear, settings URLs bounce.
  const expectNoSetup = async () => {
    await page.goto("/printers");
    await expect(page.getByRole("heading", { name: "Printers", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add printer" })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("link", { name: /settings/i })).toHaveCount(0);
    await page.goto("/orders/settings");
    await expect(page).toHaveURL(/\/orders$/);
  };

  // Viewer: reads everything, changes nothing.
  await signInAs(page, "vic@example.com");
  await browsesCleanly();
  const viewerSections = await settingsSections();
  expect(viewerSections).toEqual(expect.arrayContaining(["General", "Appearance"]));
  for (const s of adminOnly) expect(viewerSections).not.toContain(s);
  await expect(page.getByRole("button", { name: "Stop server" })).toHaveCount(0);
  expect(await seesAdminMenu()).toBe(false);
  await expect(page.getByRole("link", { name: "Add client" })).toHaveCount(0);
  await expectNoSetup();
  await expect(page.getByRole("button", { name: "Delete Acme" })).toHaveCount(0);
  await page.goto(`/clients/${id}`);
  await expect(page.getByRole("heading", { name: "Acme" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  // Editor: edits, but has no admin menu.
  await signInAs(page, "eva@example.com");
  await browsesCleanly();
  for (const s of adminOnly) expect(await settingsSections()).not.toContain(s);
  expect(await seesAdminMenu()).toBe(false);
  await expect(page.getByRole("link", { name: "Add client" })).toBeVisible();
  await expectNoSetup();
  await page.goto(`/clients/${id}`);
  await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
  await post(page, "/api/clients", { name: "Zed", mobile: "922" });
  // The server says the same.
  for (const [path, data] of [
    ["/api/printers", { name: "P" }],
    ["/api/maintenance/types", { name: "T" }],
  ] as const)
    expect((await page.request.post(path, { data })).status(), path).toBe(403);

  // Admin: full menu, Branding as its own section, and the log names who did what.
  await signInAs(page, "ana@example.com");
  expect(await settingsSections()).toEqual(expect.arrayContaining(adminOnly));
  await expect(page.getByRole("button", { name: "Stop server" })).toBeVisible();
  expect(await seesAdminMenu()).toBe(true);
  await side.getByRole("link", { name: "Logs" }).click();
  const table = page.getByRole("table", { name: "Logs" });
  await expect(
    table.getByRole("row").filter({ hasText: "POST /api/clients 201" }).filter({
      hasText: "Eva Editor",
    }),
  ).toBeVisible();
});
