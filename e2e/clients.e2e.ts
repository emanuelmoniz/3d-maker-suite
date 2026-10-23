import { expect, test } from "./fixtures.ts";

test("clients: create, edit, duplicates show an error on their field", async ({ page }) => {
  const add = async (name: string, mobile: string, extra: Record<string, string> = {}) => {
    await page.goto("/clients/new");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Mobile").fill(mobile);
    for (const [label, value] of Object.entries(extra)) await page.getByLabel(label).fill(value);
    await page.getByRole("button", { name: "Save" }).click();
  };

  await add("Ana Silva", "911", { VAT: "PT123", Email: "ana@example.com" });
  await expect(page.getByRole("heading", { name: "Ana Silva" })).toBeVisible();

  await add("Rui", "911");
  await expect(page.getByText("Another client has this mobile.")).toBeVisible();
  await page.getByLabel("Mobile").fill("912");
  await page.getByLabel("VAT").fill("PT123");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Another client has this VAT.")).toBeVisible();
  await page.getByLabel("VAT").fill("");
  await page.getByLabel("Email").fill("ANA@example.com");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Another client has this email.")).toBeVisible();
  await page.getByLabel("Email").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Rui" })).toBeVisible();

  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Notes").fill("Prefers PETG");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Prefers PETG")).toBeVisible();

  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Ana Silva" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rui" })).toBeVisible();

  await page.getByRole("link", { name: "Rui" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole("link", { name: "Rui" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ana Silva" })).toBeVisible();
});
