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
  // A sync raises a success alert, with buttons to the module and the integration.
  const integration = await post(page, "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await post(page, `/api/integrations/${integration.id}/sync`, { type: "printers" });
  // No spool matches the mock prints, so the (auto) prints sync leaves them for review.
  await post(page, `/api/integrations/${integration.id}/sync`, { type: "prints" });

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
  // Alerts: the viewer reads and unreads their own, but gets none of the fixes.
  await page.goto("/alerts");
  await page.getByRole("link", { name: /^Printers from .* synced$/ }).click();
  await expect(page.locator("dd", { hasText: /^Read$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open integration" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View printers" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mark as unread" }).click();
  await expect(page.locator("dd", { hasText: /^Unread$/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark as read" }).click();
  await expect(page.locator("dd", { hasText: /^Read$/ })).toBeVisible();

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
  // The viewer reading the alert left it unread for the editor.
  await page.goto("/alerts");
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: /Printers from .* synced/ })
      .getByTitle("Unread"),
  ).toBeVisible();
  // The server says the same.
  for (const [path, data] of [
    ["/api/printers", { name: "P" }],
    ["/api/maintenance/types", { name: "T" }],
  ] as const)
    expect((await page.request.post(path, { data })).status(), path).toBe(403);

  // Integrations: nothing for an editor until the admin allows a task.
  const syncUrl = `/api/integrations/${integration.id}/sync`;
  expect((await page.request.post(syncUrl, { data: { type: "printers" } })).status()).toBe(403);
  await page.goto("/alerts");
  await page.getByRole("link", { name: /^Printers from .* synced$/ }).click();
  await expect(page.getByRole("heading", { name: "Alert", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open integration" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View printers" })).toHaveCount(0);

  // The admin lets editors sync printers (on the page) and review print history.
  await signInAs(page, "ana@example.com");
  await page.goto("/integrations");
  await page.getByRole("button", { name: "Settings: Printers" }).click();
  // The switch's input is sr-only under the drawn track.
  const editorSync = page.getByRole("switch", { name: "Editors can sync now: Printers" });
  await editorSync.click({ force: true });
  await expect(editorSync).toBeChecked();
  await page.request.patch(`/api/integrations/${integration.id}`, {
    data: { policies: [{ type: "prints", editorReview: true }] },
  });

  // The editor gets the page with those two tasks and their one button each, nothing else.
  await signInAs(page, "eva@example.com");
  await page.goto("/clients");
  await side.getByRole("link", { name: "Integrations" }).click();
  const main = page.getByRole("main");
  await expect(main.getByText("Print history", { exact: true })).toBeVisible();
  await expect(main.getByText("Printers", { exact: true })).toBeVisible();
  await expect(main.getByText("Spools", { exact: true })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Sync now" })).toHaveCount(1);
  await expect(main.getByRole("link", { name: "Review and import" })).toHaveCount(1);
  for (const setup of [
    main.getByRole("button", { name: /^Settings:/ }),
    main.getByLabel("Enabled"),
    main.getByRole("button", { name: "Test connection" }),
    main.getByRole("link", { name: "Add integration" }),
  ])
    await expect(setup).toHaveCount(0);
  const synced = page.waitForResponse((r) => r.url().endsWith(syncUrl));
  await main.getByRole("button", { name: "Sync now" }).click();
  expect((await synced).status()).toBe(200);
  await main.getByRole("link", { name: "Review and import" }).click();
  await expect(page).toHaveURL(new RegExp(`/import/integration/${integration.id}/prints`));
  await expect(page.getByRole("heading", { name: "Print history" })).toBeVisible();
  await expect(page.getByText("Your role doesn't allow that")).toHaveCount(0);

  // The same from the alerts: Review on the waiting prints, Open integration on the sync.
  await page.goto("/alerts");
  await page
    .getByRole("listitem")
    .filter({ hasText: /wait(ing)? for your review/ })
    .getByRole("link")
    .click();
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/import/integration/${integration.id}/prints`));
  await page.goto("/alerts");
  await page.getByRole("link", { name: /^Printers from .* synced$/ }).click();
  await page.getByRole("link", { name: "Open integration" }).click();
  await expect(page).toHaveURL(/\/integrations#integration-/);
  await expect(page.getByText("Your role doesn't allow that")).toHaveCount(0);

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
