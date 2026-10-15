import { expect, test } from "./fixtures.ts";
import { seedSpool } from "./helpers.ts";

test("combobox: type to filter, keyboard picks, Escape stays inside a dialog", async ({
  page,
  app,
}) => {
  await page.goto("/settings");
  const units = page.getByRole("combobox", { name: "Units" });
  await expect(units).toHaveValue(/^Metric/);

  // Typing filters; Enter picks the first match.
  await units.click();
  await page.keyboard.type("imp");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(units).toHaveValue(/^Imperial/);
  await expect(units).toHaveAttribute("aria-expanded", "false");

  // No match: the list says so; Escape restores the selection.
  await page.keyboard.type("zzz");
  await expect(page.getByRole("status").getByText("No matches")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(units).toHaveValue(/^Imperial/);

  // Arrows move the highlight; Tab picks it and moves on.
  await page.keyboard.press("ArrowDown");
  await expect(units).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Tab");
  await expect(units).toHaveValue(/^Metric/);
  await expect(units).not.toBeFocused();

  // Inside a modal dialog: the list shows above it, the first Escape only closes the list.
  const spool = await seedSpool(app.api);
  await page.goto(`/filament/spools/${spool.id}`);
  await page.getByRole("button", { name: "Adjust weight" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Reason" }).click();
  await page.getByRole("option", { name: "Correction" }).click();
  await expect(dialog.getByRole("combobox", { name: "Reason" })).toHaveValue("Correction");
  await dialog.getByRole("combobox", { name: "Reason" }).press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
