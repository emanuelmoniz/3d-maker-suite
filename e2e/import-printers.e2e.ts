import { expect, test } from "./fixtures.ts";

test("Manual import on the Printers row reviews the cloud's printers", async ({ page, app }) => {
  await app.api("POST", "/api/integrations", { adapterId: "mock", secrets: { token: "t" } });

  await page.goto("/integrations");
  await page
    .getByRole("listitem")
    .filter({ hasText: /^Printers/ })
    .getByRole("link", { name: "Manual import" })
    .click();
  await expect(page.getByRole("cell", { name: "MOCK0001" })).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Import \d+ rows?$/ })
    .click();
  await expect(page.getByText(/^Import finished/)).toBeVisible();

  const printers = await app.api<{ items: { serial: string | null }[] }>("GET", "/api/printers");
  expect(printers.items.map((p) => p.serial)).toEqual(["MOCK0001"]);
});
