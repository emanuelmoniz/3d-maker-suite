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

  // Viewer: reads everything, changes nothing.
  await signInAs(page, "vic@example.com");
  expect(await seesAdminMenu()).toBe(false);
  await expect(page.getByRole("link", { name: "Add client" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Acme" })).toHaveCount(0);
  await page.goto(`/clients/${id}`);
  await expect(page.getByRole("heading", { name: "Acme" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  // Editor: edits, but has no admin menu.
  await signInAs(page, "eva@example.com");
  expect(await seesAdminMenu()).toBe(false);
  await expect(page.getByRole("link", { name: "Add client" })).toBeVisible();
  await page.goto(`/clients/${id}`);
  await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
  await post(page, "/api/clients", { name: "Zed", mobile: "922" });

  // Admin: full menu, and the log names who did what.
  await signInAs(page, "ana@example.com");
  expect(await seesAdminMenu()).toBe(true);
  await side.getByRole("link", { name: "Logs" }).click();
  const table = page.getByRole("table", { name: "Logs" });
  await expect(
    table.getByRole("row").filter({ hasText: "POST /api/clients 201" }).filter({
      hasText: "Eva Editor",
    }),
  ).toBeVisible();
});
