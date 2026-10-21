import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { pick, seedPrinter } from "./helpers.ts";

/** Opens the Import page on a type and uploads a CSV (the headers are the column labels). */
const upload = async (page: Page, type: string, csv: string) => {
  await page.goto("/import");
  await pick(page.getByRole("combobox", { name: "What to import" }), type);
  await page.getByLabel("Upload a file").setInputFiles({
    name: "installs.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
};

test("import accessory installs; an unknown reference and an overlap show in the review", async ({
  page,
  app,
}) => {
  const alpha = await seedPrinter(app.api, "Alpha");
  const ams = await app.api<{ id: string }>("POST", "/api/accessories", {
    name: "AMS",
    type: "AMS",
  });
  await app.api("POST", `/api/accessories/${ams.id}/installs`, {
    printerId: alpha.id,
    installedAt: "2026-01-01T12:00:00.000Z",
    removedAt: "2026-02-01T12:00:00.000Z",
  });

  await upload(
    page,
    "Accessory installs",
    "Accessory;Printer;Installed;Removed\nAMS;Alpha;2026-01-15;2026-01-20\nNobody;Alpha;2026-03-01;\n1-AMS;Alpha;2026-03-01;2026-03-10\n",
  );
  await expect(page.getByRole("button", { name: "New (1)" })).toBeVisible();
  await expect(page.getByText("The accessory is on a printer during that period")).toBeVisible();
  await expect(page.getByText("Not found, or matches more than one")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 1 created, 0 updated.")).toBeVisible();

  const installs = await app.api<{ printerLabel: string; removedAt: string }[]>(
    "GET",
    `/api/accessories/${ams.id}/installs`,
  );
  expect(installs).toMatchObject([
    { printerLabel: "01-Alpha", removedAt: "2026-03-10T12:00:00.000Z" },
    { printerLabel: "01-Alpha", removedAt: "2026-02-01T12:00:00.000Z" },
  ]);
});
