import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { pick, seedProject } from "./helpers.ts";

/** Opens the Import page on a type and uploads a CSV (the headers are the column labels). */
const upload = async (page: Page, type: string, csv: string) => {
  await page.goto("/import");
  await pick(page.getByRole("combobox", { name: "What to import" }), type);
  await page.getByLabel("Upload a file").setInputFiles({
    name: `${type}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
};

test("import clients, then an order that names one; an unknown reference shows in the review", async ({
  page,
  app,
}) => {
  await seedProject(app.api, "Box");

  await upload(page, "Clients", "Name;Mobile;Email\nAna;911;ana@example.com\nBruno;922;\n");
  await expect(page.getByRole("button", { name: "New (2)" })).toBeVisible();
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("Import finished: 2 created, 0 updated.")).toBeVisible();

  await upload(page, "Orders", "Client;Project;Price\nAna;1-Box;25\nNobody;Box;10\n");
  await expect(page.getByRole("button", { name: "New (1)" })).toBeVisible();
  await expect(page.getByText("Not found, or matches more than one")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 1 created, 0 updated.")).toBeVisible();
  await page.getByRole("link", { name: "View orders" }).click();
  await expect(page.getByRole("row", { name: /Ana/ })).toContainText("25");
});
