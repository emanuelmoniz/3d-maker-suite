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

  // First run: Settings offers to create the admin.
  await page.goto("/settings");
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
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.getByRole("button", { name: "Add user" }).click();
  const add = page.getByRole("dialog", { name: "Add user" });
  await add.getByLabel("Name").fill("Eva Editor");
  await add.getByLabel("Email").fill("eva@example.com");
  await add.getByLabel("New password").fill(PASSWORD);
  await add.getByLabel("Role").fill("Editor");
  await add.getByRole("option", { name: "Editor" }).click();
  await add.getByRole("button", { name: "Save" }).click();
  const users = page.getByRole("list", { name: "Users" });
  await expect(users.getByRole("listitem").filter({ hasText: "Eva Editor" })).toBeVisible();
  await expect(page.getByLabel("Role of Eva Editor")).toHaveValue("Editor");

  // The last admin is protected.
  await users
    .getByRole("listitem")
    .filter({ hasText: "Ana Admin" })
    .getByRole("button", { name: "Disable" })
    .click();
  await expect(page.getByRole("alert").filter({ hasText: "last enabled admin" })).toBeVisible();

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
  await page.goto("/settings");
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
