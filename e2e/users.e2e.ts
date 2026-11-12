import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const PASSWORD = "correct horse";

const signIn = async (page: Page, email: string, password: string) => {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.keyboard.press("Enter"); // by keyboard: the form submits, no button click
};

test("users: setup, add a user, sign out and in, change password", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  // First run: Users | Roles offers to create the admin.
  await page.goto("/users");
  await page.getByRole("link", { name: "Create the first admin" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("Name").fill("Ana Admin");
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByLabel("Repeat the password").fill("something else");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("The two passwords don't match.")).toBeVisible();
  await page.getByLabel("Repeat the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByLabel("Account menu for Ana Admin").click();
  await expect(page.getByText("ana@example.com · Admin")).toBeVisible();

  // The admin adds an editor.
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users | Roles" })).toBeVisible();
  await page.getByRole("button", { name: "Add user" }).click();
  const add = page.getByRole("dialog", { name: "Add user" });
  await add.getByLabel("Name").fill("Eva Editor");
  await add.getByLabel("Email").fill("eva@example.com");
  await add.getByLabel("New password").fill(PASSWORD);
  await add.getByLabel("Role").fill("Editor");
  await add.getByRole("option", { name: "Editor" }).click();
  await add.getByRole("button", { name: "Save" }).click();
  const users = page.getByRole("table", { name: "Users" });
  const eva = users.getByRole("row").filter({ hasText: "Eva Editor" });
  await expect(eva.getByRole("link", { name: "Editor", exact: true })).toBeVisible();
  await expect(eva.getByText("Never signed in")).toBeVisible();

  // Nobody disables or deletes their own account.
  const ana = users.getByRole("row").filter({ hasText: "Ana Admin" });
  await expect(ana.getByRole("button", { name: "Disable Ana Admin" })).toHaveCount(0);
  await expect(ana.getByRole("button", { name: "Delete Ana Admin" })).toHaveCount(0);

  // Sign out; a deep link sends the visitor to the login and back.
  await page.getByLabel("Account menu for Ana Admin").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/printers");
  await expect(page).toHaveURL(/\/login\?next=%2Fprinters$/);

  await signIn(page, "eva@example.com", "wrong password");
  await expect(page.getByRole("alert")).toHaveText("Wrong email or password.");
  await signIn(page, "eva@example.com", PASSWORD);
  await expect(page).toHaveURL(/\/printers$/);

  // The editor has no Users section, but can change their own password.
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Users" })).toHaveCount(0);
  await page.getByLabel("Current password").fill("nope nope nope");
  await page.getByLabel("New password").fill("a brand new one");
  await page.getByLabel("Repeat the password").fill("a brand new one");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The current password is wrong.")).toBeVisible();
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();

  // A 403 from the server shows a message.
  await page.evaluate(() => window.dispatchEvent(new Event("app:forbidden")));
  await expect(
    page.getByRole("alert").filter({ hasText: "Your role doesn't allow that" }),
  ).toBeVisible();
});

test("users: a custom role and an override change what a user sees", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await app.api("POST", "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  await page.goto("/login");
  await signIn(page, "ana@example.com", PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  // A viewer: no printer setup, no clients.
  await page.request.post("/api/users", {
    data: {
      displayName: "Pat Tech",
      email: "pat@example.com",
      password: PASSWORD,
      roleId: "00000000-0000-4000-8000-000000000003",
    },
  });

  // A new role from Viewer that manages printers, picked by keyboard on the ladder.
  await page.goto("/users/roles");
  await page.getByRole("link", { name: "New role" }).click();
  await page.getByLabel("Name").fill("Printer tech");
  const printers = page.getByRole("group", { name: /^Printers and accessories/ });
  await expect(printers.getByRole("radio", { name: "Read" })).toBeChecked();
  await printers.getByRole("radio", { name: "Read" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(printers.getByRole("radio", { name: "Manage" })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Printer tech" })).toBeVisible();

  // Pat gets the role, plus write on quotes, orders and clients as an override.
  await page.goto("/users");
  await page.getByRole("table", { name: "Users" }).getByRole("link", { name: "Pat Tech" }).click();
  await page.getByRole("combobox", { name: "Role" }).fill("Printer tech");
  await page.getByRole("option", { name: "Printer tech" }).click();
  const costs = page.getByRole("group", { name: /^Quotes, orders and clients/ });
  await expect(costs.getByText("From the role: Read")).toBeVisible();
  await costs.getByText("Write", { exact: true }).click();
  await expect(costs.getByText("The role has Read")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  // The edit page fits a phone.
  await page.setViewportSize({ width: 375, height: 700 });
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);

  // Pat sees both: printer setup from the role, Add client from the override.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().clearCookies();
  await page.goto("/login");
  await signIn(page, "pat@example.com", PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/printers");
  await expect(page.getByRole("link", { name: "Add printer" }).first()).toBeVisible();
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Add client" }).first()).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Users | Roles" })).toHaveCount(0);
  await page.goto("/users");
  await expect(page).toHaveURL(/\/$/);
});

test("users: old Settings links land on Users | Roles", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await app.api("POST", "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  await page.goto("/login");
  await signIn(page, "ana@example.com", PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/settings#roles");
  await expect(page).toHaveURL(/\/users\/roles$/);
  await expect(page.getByRole("table", { name: "Roles" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Editor", exact: true })).toBeVisible();
  await page.goto("/settings#users");
  await expect(page).toHaveURL(/\/users$/);
  await page.goto("/settings/roles/new");
  await expect(page).toHaveURL(/\/users\/roles\/new$/);
  await page.getByRole("link", { name: "Users | Roles" }).first().click();
  await expect(page).toHaveURL(/\/users$/);
});

test("users: login and sign out fit a phone", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await app.api("POST", "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
  await signIn(page, "ana@example.com", PASSWORD);
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("users: my alerts and delivery on My account, an admin sets another user's alerts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(path, { data });
    expect(res.ok(), `${path} ${res.status()}`).toBe(true);
    return (await res.json()) as { id: string };
  };
  await post("/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  // The seeded Viewer role.
  const eva = await post("/api/users", {
    displayName: "Vic Viewer",
    email: "vic@example.com",
    password: PASSWORD,
    roleId: "00000000-0000-4000-8000-000000000003",
  });

  // The admin gives Vic maintenance alerts by notify.
  await page.goto(`/users/${eva.id}`);
  const maintenance = page.getByLabel("Maintenance due");
  await expect(maintenance).toHaveValue("");
  await maintenance.selectOption("notify");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  // Vic sees it on My account, changes another kind, and sets their delivery.
  await page.context().clearCookies();
  await post("/api/auth/login", { email: "vic@example.com", password: PASSWORD });
  await page.goto("/account");
  await expect(page.getByLabel("Maintenance due")).toHaveValue("notify");
  // A viewer has no integrations or hub permission: those kinds aren't listed.
  await expect(page.getByLabel("Sync failed")).toHaveCount(0);
  await page.getByLabel("Spool running low").selectOption("off");
  await page.reload();
  await expect(page.getByLabel("Spool running low")).toHaveValue("off");
  await page.getByRole("button", { name: "Reset all to the role" }).click();
  await expect(page.getByLabel("Spool running low")).toHaveValue("");

  await page.getByRole("switch", { name: "Email" }).check({ force: true });
  await page.getByLabel("ntfy topic").fill("vic-alerts");
  await page.getByLabel("ntfy access token").fill("tk_secret");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.getByText("A token is stored")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("ntfy topic")).toHaveValue("vic-alerts");
  await expect(page.getByLabel("ntfy access token")).toHaveValue("");
});
