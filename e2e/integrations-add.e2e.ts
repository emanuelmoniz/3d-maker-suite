import { expect, test } from "./fixtures.ts";

for (const width of [375, 1440])
  test(`add a slicer by where it runs, then another location from its card (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/integrations/new");
    await page.getByRole("radio", { name: "Bambu Studio" }).check();
    // The workstation needs the hub; this computer is free, so it is picked.
    const tile = (name: string) => page.getByRole("radio", { name });
    await expect(tile("On a connected workstation")).toBeDisabled();
    await expect(page.getByText("Turn on the hub in Hub management")).toBeVisible();
    await expect(tile("Installed on this computer")).toBeChecked();
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // One card for the slicer, with the new location open.
    await expect(page).toHaveURL(/\/integrations#integration-/);
    const card = page.getByRole("region", { name: "Bambu Studio" });
    await expect(card.getByRole("heading", { name: "This computer", level: 3 })).toBeVisible();
    await expect(card.getByRole("textbox", { name: "Config folder" })).toBeVisible();

    // Add location: the slicer is picked, this computer is taken.
    await card.getByRole("link", { name: "Add location" }).click();
    await expect(page.getByRole("radio", { name: "Bambu Studio" })).toBeChecked();
    await expect(tile("Installed on this computer")).toBeDisabled();
    await expect(tile("Download it to this server")).toBeChecked();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(card.getByRole("heading", { name: "This server", level: 3 })).toBeVisible();
    await expect(card.getByRole("button", { name: "Install slicer" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );

    // Its catalog cards are on Catalog → Sources.
    await card.getByRole("link", { name: /^Catalog: / }).click();
    await expect(page).toHaveURL(/\/catalog\/sources#library-bambu-studio$/);
    const sources = page.getByRole("region", { name: "Bambu Studio" });
    await expect(sources.getByRole("heading", { name: "This computer", level: 3 })).toBeVisible();
    await expect(sources.getByRole("heading", { name: "This server", level: 3 })).toBeVisible();
  });
