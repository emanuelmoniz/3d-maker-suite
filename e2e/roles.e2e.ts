import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { editLine, lineMenu } from "./helpers.ts";

const PASSWORD = "correct horse";
// The seeded roles (migration 0086).
const EDITOR = "00000000-0000-4000-8000-000000000002";
const VIEWER = "00000000-0000-4000-8000-000000000003";

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
  for (const [displayName, email, roleId] of [
    ["Eva Editor", "eva@example.com", EDITOR],
    ["Vic Viewer", "vic@example.com", VIEWER],
  ])
    await post(page, "/api/users", { displayName, email, password: PASSWORD, roleId });
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
  // Alerts: sync alerts need the sync permission, so the viewer gets none.
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alerts", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Printers from .* synced$/ })).toHaveCount(0);

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
  // The sync policy does not let editors sync yet, so the alert is hidden from them too.
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alerts", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Printers from .* synced$/ })).toHaveCount(0);
  // The server says the same.
  for (const [path, data] of [
    ["/api/printers", { name: "P" }],
    ["/api/maintenance/types", { name: "T" }],
  ] as const)
    expect((await page.request.post(path, { data })).status(), path).toBe(403);

  // Integrations: nothing for an editor until the admin allows a task.
  const syncUrl = `/api/integrations/${integration.id}/sync`;
  expect((await page.request.post(syncUrl, { data: { type: "printers" } })).status()).toBe(403);

  // The admin lets editors sync printers and review print history, on their Sources lines.
  await signInAs(page, "ana@example.com");
  const edit = await editLine(page, "printers", "Printers");
  // The switch's input is sr-only under the drawn track.
  const editorSync = edit.getByRole("switch", { name: "Editors can sync now: Printers" });
  await editorSync.click({ force: true });
  await expect(editorSync).toBeChecked();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await page.request.patch(`/api/integrations/${integration.id}`, {
    data: { policies: [{ type: "prints", editorReview: true }] },
  });

  // The editor gets each task from its page's gear: the Sources tab alone, one task each, no
  // settings. Integrations has nothing left for them (ADR-0021).
  await signInAs(page, "eva@example.com");
  await page.goto("/clients");
  await expect(side.getByRole("link", { name: "Integrations" })).toHaveCount(0);
  await page.goto("/printers");
  await page.getByRole("link", { name: "Printers settings" }).click();
  await expect(page).toHaveURL(/\/printers\/settings\/sources$/);
  const main = page.getByRole("main");
  for (const setup of [
    main.getByRole("link", { name: "General" }),
    main.getByRole("button", { name: /^Edit / }),
    main.getByRole("link", { name: "Account" }),
  ])
    await expect(setup).toHaveCount(0);
  await expect(main.getByRole("switch", { name: /^Sync Printers from / })).toBeDisabled();
  await lineMenu(page, "Printers");
  await expect(page.getByRole("link", { name: /^Review and import/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sync log" })).toHaveCount(0);
  const synced = page.waitForResponse((r) => r.url().endsWith(syncUrl));
  await page.getByRole("button", { name: "Sync now" }).click();
  expect((await synced).status()).toBe(200);
  // General is the settings page itself: without the permission, back to Sources.
  await page.goto("/printers/settings");
  await expect(page).toHaveURL(/\/printers\/settings\/sources$/);

  await page.goto("/prints");
  await page.getByRole("link", { name: "Prints settings" }).click();
  await lineMenu(page, "Print history");
  await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  await page.getByRole("link", { name: /^Review and import/ }).click();
  await expect(page).toHaveURL(new RegExp(`/import/integration/${integration.id}/prints`));
  await expect(page.getByRole("heading", { name: "Print history" })).toBeVisible();
  await expect(page.getByText("Your role doesn't allow that")).toHaveCount(0);
  // No task on spools: no gear, and its Sources tab sends them back.
  await page.goto("/filament/settings/sources");
  // The page may already have added its default filter to the address.
  await expect(page).toHaveURL(/\/filament(\?|$)/);

  // The same from the alerts: Review on the waiting prints, Open sources on the sync.
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
  await page.getByRole("link", { name: "Open sources" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/printers/settings/sources#source-${integration.id}-printers$`),
  );
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

test("bulk needs manage: a write user gets no selection and the API refuses them", async ({
  page,
}) => {
  await page.goto("/");
  await post(page, "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  const { id } = await post(page, "/api/clients", { name: "Bea", mobile: "911" });
  await expect(async () => {
    await page.goto("/clients");
    await expect(page.getByRole("checkbox", { name: "Select Bea" })).toBeVisible({ timeout: 1000 });
  }).toPass();

  const write = await post(page, "/api/roles", {
    name: "Clerk",
    permissions: { costs: "write" },
  });
  await post(page, "/api/users", {
    displayName: "Wes",
    email: "wes@example.com",
    password: PASSWORD,
    roleId: write.id,
  });
  await signInAs(page, "wes@example.com");

  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Bea" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive Bea" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(1); // Show archived
  const res = await page.request.post("/api/bulk/clients", {
    data: { action: "archive", ids: [id] },
  });
  expect(res.status()).toBe(403);
});

test("filament catalog rows follow the catalog permission, not the filament one", async ({
  page,
}) => {
  await page.goto("/");
  await post(page, "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  await post(page, "/api/filament-brands", { name: "Acme" });
  const role = await post(page, "/api/roles", {
    name: "Filament keeper",
    // ADR-0020: catalog rows need catalog manage; filament manage alone doesn't edit them.
    permissions: { filament: "read", printers: "read", catalog: "manage" },
  });
  await post(page, "/api/users", {
    displayName: "Fay",
    email: "fay@example.com",
    password: PASSWORD,
    roleId: role.id,
  });
  await signInAs(page, "fay@example.com");

  await page.goto("/catalog/filament");
  await expect(page.getByRole("link", { name: "Add brand" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Acme" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive Acme" })).toBeVisible();
  await page.getByRole("link", { name: "Acme" }).click();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
});
