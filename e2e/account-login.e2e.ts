import { expect, test } from "./fixtures.ts";

// 6.1.0 Step 10c: an account signs in inside the Add form (code step in place) and is created only
// then; a signed-out one signs in again from its Edit page, reached through the badge.
const NAME = "Demo account with sign-in (mock)";

test("add an account with the emailed code, without leaving the form", async ({ page, app }) => {
  await page.goto("/integrations/new?product=mock-login");
  await page.getByLabel("Label").fill("Workshop");
  // No Test: the sign-in is the test.
  await expect(page.getByRole("button", { name: "Test connection" })).toHaveCount(0);

  // A wrong password saves nothing.
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByLabel("Password").fill("nope");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong email or password.");
  expect(await app.api<unknown[]>("GET", "/api/integrations")).toHaveLength(0);

  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("We sent a code to your email.")).toBeVisible();
  await expect(page).toHaveURL(/\/integrations\/new/);
  // Still nothing saved while the code is asked for.
  expect(await app.api<unknown[]>("GET", "/api/integrations")).toHaveLength(0);

  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page).toHaveURL(/\/integrations#integration-/);
  const rows = await app.api<{ hasSecrets: boolean; adapterId: string }[]>(
    "GET",
    "/api/integrations",
  );
  expect(rows).toEqual([expect.objectContaining({ adapterId: "mock-login", hasSecrets: true })]);
  await page.goto("/integrations#mock-login");
  const card = page.getByRole("region", { name: NAME });
  await expect(card.getByRole("heading", { name: "Workshop", level: 3 })).toBeVisible();
  await expect(card.getByText("Signed in", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: /Sign in/ })).toHaveCount(0);
});

test("a signed-out account signs in again on its Edit page, through the badge", async ({
  page,
  app,
}) => {
  // Saved without a sign-in (as before 6.1.0 Step 10c): signed out.
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock-login",
  });
  // An old sign-in link lands on the Edit page.
  await page.goto(`/integrations/${id}/login`);
  await expect(page).toHaveURL(new RegExp(`/integrations/${id}/edit$`));

  await page.goto("/integrations#mock-login");
  const card = page.getByRole("region", { name: NAME });
  await card.getByRole("link", { name: /^Signed out/ }).click();
  await expect(page).toHaveURL(new RegExp(`/integrations/${id}/edit$`));

  const block = page.getByRole("region", { name: "Sign in" });
  await block.getByLabel("Email").fill("ana@example.com");
  await block.getByLabel("Password").fill("pw");
  await block.getByRole("button", { name: "Sign in" }).click();
  await block.getByLabel("Verification code").fill("123456");
  await block.getByRole("button", { name: "Verify" }).click();
  await expect(block.getByRole("status")).toHaveText("Signed in. The printers are synced now.");

  await page.goto("/integrations#mock-login");
  await expect(card.getByText("Signed in", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: /^Signed out/ })).toHaveCount(0);
});
