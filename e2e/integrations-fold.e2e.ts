import { expect, test } from "./fixtures.ts";

// 6.1.0 Step 8: cards fold, the state is remembered per browser, and a link to a row opens its card.
test("an integration card is folded by default, remembers it, and opens from a link", async ({
  page,
}) => {
  await page.goto("/integrations/new");
  await page.getByRole("radio", { name: "Demo data (mock)" }).check();
  await page.getByLabel("Label").fill("Fold test");
  await page.getByLabel(/^Token/).fill("ana");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForURL(/\/integrations#integration-/);
  const id = page.url().split("#integration-")[1];

  // Arrived by a link to the row: its card is open and shows it.
  const header = page.getByRole("button", { name: /Demo data/ });
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`#integration-${id}`)).toBeVisible();

  // Plain visit: folded (a healthy card), until it is opened; then it stays open after a reload.
  await page.goto("/integrations");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-expanded", "false");
});

// 6.1.0 Step 10: Remove integration takes the whole card, and Add integration brings it back.
test("Remove integration removes the card after a confirmation", async ({ page }) => {
  await page.goto("/integrations/new");
  await page.getByRole("radio", { name: "Demo data (mock)" }).check();
  await page.getByLabel("Label").fill("Remove test");
  await page.getByLabel(/^Token/).fill("ana");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForURL(/\/integrations#integration-/);

  await page.getByRole("button", { name: /^More actions for Demo data/ }).click();
  await page.getByRole("button", { name: "Remove integration" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Stays: imported printers, prints and spools");
  await dialog.getByRole("button", { name: "Remove integration" }).click();
  await expect(page.getByRole("button", { name: /Demo data/ })).toHaveCount(0);
});
