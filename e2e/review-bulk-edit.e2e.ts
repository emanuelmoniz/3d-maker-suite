import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, openBulkEdit, pick, seedSpool } from "./helpers.ts";

const upload = async (page: Page, lines: string[]) => {
  await page.goto("/import");
  await page.getByLabel("Upload a file").setInputFiles({
    name: "spools.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n")),
  });
  await expect(page.getByRole("heading", { name: "Review rows" })).toBeVisible();
};
const importRows = async (page: Page, count: number) => {
  const name = count === 1 ? "Import 1 row" : `Import ${count} rows`;
  await page.getByRole("button", { name }).click();
  await page.getByRole("dialog").getByRole("button", { name }).click();
  await expect(page.getByText(/^Import finished/)).toBeVisible();
};
const field = (form: Locator, name: string) => form.getByRole("combobox", { name, exact: true });
const apply = (form: Locator) => form.getByRole("button", { name: "Apply", exact: true }).click();
/** Ticks the rows shown and gives them this action. */
const setAction = async (page: Page, action: string) => {
  const form = await openBulkEdit(page);
  await pick(field(form, "Action"), action);
  await apply(form);
};
const actions = (page: Page, rows: number[]) =>
  Promise.all(
    rows.map((row) =>
      page.getByRole("combobox", { name: `Action for row ${row}`, exact: true }).inputValue(),
    ),
  );
const nylon = () => [
  "Brand;Material;Initial weight (g)",
  ...Array.from({ length: 30 }, (_, i) => `Acme;Nylon;${(i + 1) * 10}`),
];
/** Spool 1 and 2 exist; the file changes 1, repeats 2 and adds one. */
const mixedFile = async (page: Page) => {
  await upload(page, [
    "Brand;Material;Initial weight (g);Location",
    "Acme;PLA;100;Shelf A",
    "Acme;PETG;200;Shelf B",
  ]);
  await importRows(page, 2);
  await upload(page, [
    "Number;Brand;Material;Initial weight (g);Location",
    "1;Acme;PLA;100;Shelf C",
    "2;Acme;PETG;200;Shelf B",
    ";Acme;ABS;400;Shelf E",
  ]);
  await expect(page.getByRole("button", { name: "Changed (1)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Identical (1)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New (1)" })).toBeVisible();
};

test("the old presets: only new rows, only changed, all as new, skip", async ({ page, app }) => {
  await mixedFile(page);
  const chip = (name: string) => page.getByRole("button", { name });

  await setAction(page, "Skip");
  await expect(page.getByRole("button", { name: /^Import \d+/ })).toBeDisabled();
  expect(await actions(page, [2, 3, 4])).toEqual(["Skip", "Skip", "Skip"]);

  // Only new rows: everything skipped, then the New ones back.
  await chip("New (1)").click();
  await setAction(page, "Create");
  await chip("New (1)").click();
  expect(await actions(page, [2, 3, 4])).toEqual(["Skip", "Skip", "Create"]);

  // Only changed.
  await setAction(page, "Skip");
  await chip("Changed (1)").click();
  await setAction(page, "Update");
  await chip("Changed (1)").click();
  expect(await actions(page, [2, 3, 4])).toEqual(["Update", "Skip", "Skip"]);

  // The suggestions again.
  await setAction(page, "Use suggestion");
  expect(await actions(page, [2, 3, 4])).toEqual(["Update", "Skip", "Create"]);

  // All as new, whatever they matched.
  await setAction(page, "Create");
  expect(await actions(page, [2, 3, 4])).toEqual(["Create", "Create", "Create"]);
  await importRows(page, 3);
  const spools = await app.api<{ items: unknown[] }>("GET", "/api/filament/spools");
  expect(spools.items).toHaveLength(5);
});

test("ticking 3 of 30 rows changes only those 3", async ({ page }) => {
  await upload(page, nylon());
  for (const row of [3, 4, 5])
    await page.getByRole("checkbox", { name: `Select row ${row}`, exact: true }).check();
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.getByRole("button", { name: "Bulk edit…" }).click();
  const form = page.getByRole("dialog", { name: "Bulk edit 3 rows" });
  await pick(field(form, "Action"), "Skip");
  // Skip takes no values.
  await expect(field(form, "Brand")).toBeDisabled();
  await apply(form);

  await expect(page.getByText("3 rows changed.")).toBeVisible();
  // Finished rows leave the selection.
  await expect(page.getByText(/\d+ selected/)).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(page.getByText("3 rows changed.")).toHaveCount(0);
  expect(await actions(page, [2, 3, 4, 5, 6])).toEqual([
    "Create",
    "Skip",
    "Skip",
    "Skip",
    "Create",
  ]);
  await expect(page.getByRole("button", { name: "Import 27 rows" })).toBeEnabled();
});

test("All columns reaches the server, per column", async ({ page, app }) => {
  await mixedFile(page);
  await page.getByRole("checkbox", { name: "Select row 2", exact: true }).check();
  await page.getByRole("button", { name: "Bulk edit…" }).click();
  const form = page.getByRole("dialog");
  await pick(field(form, "Action"), "Update");
  await pick(field(form, "All columns"), "Keep my edits, fill the rest with import values");
  await expect(field(form, "Location")).toHaveValue(
    "Keep my edits, fill the rest with import values",
  );
  await apply(form);
  await importRows(page, 2);
  const spools = await app.api<{ items: { number: number; location: string | null }[] }>(
    "GET",
    "/api/filament/spools",
  );
  // A file overwrites by default; no known edits means fill, and Shelf A is filled already.
  expect(spools.items.find((s) => s.number === 1)?.location).toBe("Shelf A");
});

test("a new opening is a new form", async ({ page }) => {
  await upload(page, ["Brand;Material;Initial weight (g)", "Acme;Nylon;100"]);
  const form = await openBulkEdit(page);
  await pick(field(form, "Action"), "Skip");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
  expect(await actions(page, [2])).toEqual(["Create"]);
  await page.getByRole("button", { name: "Bulk edit…" }).click();
  await expect(field(form, "Action")).toHaveValue("Don't change");
});

test("a value on an update row overwrites it, and shows in the table", async ({ page, app }) => {
  await mixedFile(page);
  await page.getByRole("checkbox", { name: "Select row 2", exact: true }).check();
  await page.getByRole("button", { name: "Bulk edit…" }).click();
  const form = page.getByRole("dialog");
  await pick(field(form, "Location"), "Set a value");
  await form.getByRole("textbox", { name: "Value for Location" }).fill("Shelf Z");
  await apply(form);
  await expect(page.getByText("1 row changed.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Shelf Z" })).toHaveCount(1);
  await importRows(page, 2);
  const spools = await app.api<{ items: { number: number; location: string | null }[] }>(
    "GET",
    "/api/filament/spools",
  );
  expect(spools.items.find((s) => s.number === 1)?.location).toBe("Shelf Z");
});

test("update with no match: red, the message, still selected, then Create works", async ({
  page,
  app,
}) => {
  await seedSpool(app.api);
  await upload(page, ["Brand;Material;Initial weight (g)", "Acme;Nylon;100", "Acme;Nylon;200"]);
  await setAction(page, "Update");

  await expect(page.getByText(/^2 rows have nothing to update/)).toHaveClass(/text-bad/);
  await expect(page.getByRole("combobox", { name: "Row to update for row 2" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByText("Pick the row to update")).toHaveCount(2);
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import \d+/ })).toBeDisabled();

  // Dismissing the message leaves the rows as they are, still selected.
  await page.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(page.getByText(/^2 rows have nothing to update/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss this message" })).toHaveCount(0);
  await expect(page.getByText("2 selected")).toBeVisible();

  // They are still selected, so they can go on at once.
  await page.getByRole("button", { name: "Bulk edit…" }).click();
  const form = page.getByRole("dialog");
  await pick(field(form, "Action"), "Create");
  await apply(form);
  await expect(page.getByText("2 rows changed.")).toBeVisible();
  await expect(page.getByText(/\d+ selected/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import 2 rows" })).toBeEnabled();
});

test("Update isn't offered when there is nothing to update", async ({ page }) => {
  await upload(page, ["Brand;Material;Initial weight (g)", "Acme;Nylon;100"]);
  const form = await openBulkEdit(page);
  await field(form, "Action").click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.getByText("Create", { exact: true })).toBeVisible();
  await expect(options.getByText("Update", { exact: true })).toHaveCount(0);
});

test("a field set by another is read-only", async ({ page, app }) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${id}`, {
    policies: [{ type: "prints", mode: "auto", frequency: "1h" }],
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });
  await seedSpool(app.api);
  await page.goto(`/import/integration/${id}/prints`);
  const form = await openBulkEdit(page);

  await pick(field(form, "Outcome"), "Set a value");
  await pick(form.getByRole("combobox", { name: "Value for Outcome" }), "success");
  await expect(form.getByText("Set by Outcome")).toBeVisible();
  await expect(field(form, "Failure reason")).toHaveCount(0);

  await expect(field(form, "Filament")).toBeVisible();
  await pick(field(form, "Spool"), "Set a value");
  await pick(form.getByRole("combobox", { name: "Value for Spool" }), 0);
  await expect(form.getByText("Set by Spool")).toBeVisible();
  await expect(field(form, "Filament")).toHaveCount(0);
});

test("a new filter or status chip ends the selection; sorting and paging don't", async ({
  page,
}) => {
  await upload(page, nylon());
  const selected = page.getByText("1 selected");
  await page.getByRole("checkbox", { name: "Select row 2", exact: true }).check();
  await expect(selected).toBeVisible();

  await page.getByRole("button", { name: "Initial weight (g)", exact: true }).click();
  await expect(selected).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("26–30 of 30")).toBeVisible();
  await expect(selected).toBeVisible();

  const head = page.getByRole("columnheader").filter({ hasText: "Initial weight (g)" });
  await head.getByRole("button", { name: /^Filter by/ }).click();
  await head.getByLabel("Min").fill("250");
  await head.getByRole("button", { name: "Apply" }).click();
  await expect(selected).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page
    .getByRole("checkbox", { name: /^Select row/ })
    .first()
    .check();
  await expect(selected).toBeVisible();
  await page.getByRole("button", { name: "New (30)" }).click();
  await expect(selected).toHaveCount(0);
});

test("the form works from the keyboard", async ({ page }) => {
  await upload(page, ["Brand;Material;Initial weight (g)", "Acme;Nylon;100", "Acme;Nylon;200"]);
  await page.getByRole("checkbox", { name: "Select row 2", exact: true }).focus();
  await page.keyboard.press("Space");
  const open = page.getByRole("button", { name: "Bulk edit…" });
  await open.focus();
  await page.keyboard.press("Enter");

  // Escape closes it and gives the focus back.
  const form = page.getByRole("dialog");
  await expect(field(form, "Action")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(open).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(field(form, "Action")).toBeFocused();
  await page.keyboard.type("sk");
  await page.keyboard.press("Enter"); // picks
  await expect(field(form, "Action")).toHaveValue("Skip");
  await page.keyboard.press("Enter"); // submits
  await expect(page.getByText("1 row changed.")).toBeVisible();
  expect(await actions(page, [2, 3])).toEqual(["Skip", "Create"]);
});

test("an invalid value stays in the form and says why", async ({ page }) => {
  await upload(page, ["Brand;Material;Initial weight (g)", "Acme;Nylon;100"]);
  const form = await openBulkEdit(page);
  await pick(field(form, "Initial weight (g)"), "Set a value");
  const value = form.getByRole("textbox", { name: "Value for Initial weight (g)" });
  await value.fill("heavy");
  await expect(value).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByText("Not a number")).toBeVisible();
  await apply(form);
  await expect(form).toBeVisible();
  await value.fill("500");
  await expect(form.getByText("Not a number")).toHaveCount(0);
  await apply(form);
  await expect(page.getByText("1 row changed.")).toBeVisible();
});

test("the bar and the form work at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, nylon());
  await page.getByRole("checkbox", { name: "Select row 3", exact: true }).check();
  // Clicking checks it isn't under the bottom nav.
  await page.getByRole("button", { name: "Bulk edit…" }).click();
  const form = page.getByRole("dialog");
  await expect(field(form, "Action")).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
  await pick(field(form, "Action"), "Skip");
  await apply(form);
  await expect(page.getByText("1 row changed.")).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
});
