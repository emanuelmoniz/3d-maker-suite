import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { openBulkEdit, pick, seedProject, seedSpool } from "./helpers.ts";

/** Opens the column's filter popover and applies a minimum. */
const filterBy = async (page: Page, column: string, min: string) => {
  const head = page.getByRole("columnheader").filter({ hasText: column });
  await head.getByRole("button", { name: /^Filter by/ }).click();
  await head.getByLabel("Min").fill(min);
  await head.getByRole("button", { name: "Apply" }).click();
};

test("print review: sort and filter the queue, an empty result keeps the table", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${id}`, {
    policies: [{ type: "prints", mode: "auto", frequency: "1h" }],
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });

  // The auto run holds the prints for review; importing them leaves their filament in the queue.
  await seedProject(app.api);
  await page.goto(`/import/integration/${id}/prints`);
  const form = await openBulkEdit(page);
  await pick(form.getByRole("combobox", { name: "Project", exact: true }), "Set a value");
  // 0 is "No project", 1 the project.
  await pick(form.getByRole("combobox", { name: "Value for Project" }), 1);
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Import \d+ rows?$/ })
    .click();
  await expect(page.getByText(/^Import finished/)).toBeVisible();

  await page.goto("/prints/review");
  const rows = page.getByRole("region", { name: /./ }).getByRole("row");
  await expect(rows).toHaveCount(4); // header + the three mock prints (10, 20 and 30 g)
  await page.getByRole("button", { name: "Used", exact: true }).click();
  await expect(rows.nth(1)).toContainText("10");
  await page.getByRole("button", { name: "Used", exact: true }).click();
  await expect(rows.nth(1)).toContainText("30");

  await filterBy(page, "Used", "15");
  await expect(rows).toHaveCount(3);
  await filterBy(page, "Used", "500");
  await expect(page.getByText("No results")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows).toHaveCount(4);
});

test("print review: held prints can be imported with no project (calibration prints)", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${id}`, {
    policies: [{ type: "prints", mode: "auto", frequency: "1h" }],
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });
  await seedProject(app.api);

  // No project matches their titles, so the run held them: each one asks for a project.
  await page.goto(`/import/integration/${id}/prints`);
  await expect(page.getByText("Pick a project, or No project").first()).toBeVisible();
  const form = await openBulkEdit(page);
  await pick(form.getByRole("combobox", { name: "Project", exact: true }), "Set a value");
  await pick(
    form.getByRole("combobox", { name: "Value for Project" }),
    "No project (e.g. a calibration print)",
  );
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText("Pick a project, or No project")).toHaveCount(0);
  await page.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Import \d+ rows?$/ })
    .click();
  await expect(page.getByText(/^Import finished/)).toBeVisible();
  const prints = await app.api<{ items: { projectId: string | null }[] }>("GET", "/api/prints");
  expect(prints.items.length).toBe(3);
  expect(prints.items.every((p) => p.projectId === null)).toBe(true);
});

test("import review: sort, filter and page cover every row", async ({ page }) => {
  const lines = ["Brand;Material;Initial weight (g)"];
  for (let i = 1; i <= 30; i++) lines.push(`Acme;PLA;${i * 10}`);
  await page.goto("/import");
  await page.getByLabel("Upload a file").setInputFiles({
    name: "spools.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n")),
  });
  const rows = page.getByRole("region", { name: /./ }).getByRole("row");
  await expect(page.getByText("1–25 of 30")).toBeVisible();

  // Sorting runs over all 30 rows, not just the visible page.
  await page.getByRole("button", { name: "Initial weight (g)", exact: true }).click();
  await page.getByRole("button", { name: "Initial weight (g)", exact: true }).click();
  await expect(rows.nth(1)).toContainText("300");

  await filterBy(page, "Initial weight (g)", "250");
  await expect(page.getByText("1–6 of 6")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("1–25 of 30")).toBeVisible();
});

test("choice filters search as you type and work from the keyboard", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Upload a file").setInputFiles({
    name: "spools.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Brand;Material;Initial weight (g)\nAcme;PLA;100"),
  });
  const head = page.getByRole("columnheader").filter({ hasText: "Action" });
  await head.getByRole("button", { name: /^Filter by/ }).click();
  const search = head.getByRole("searchbox", { name: "Search Action" });
  await search.fill("sk");
  await expect(head.getByLabel("Skip")).toBeVisible();
  await expect(head.getByLabel("Create")).toBeHidden();
  await search.fill("zzz");
  await expect(head.getByText("No matches")).toBeVisible();
  await search.fill("cre");
  await search.press("ArrowDown");
  await expect(head.getByLabel("Create")).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter"); // submits the form: applies the filter
  await expect(page.getByText("1–1 of 1")).toBeVisible();
  await head.getByRole("button", { name: /^Filter active|^Filter by/ }).click();
  await page.keyboard.press("Escape");
  await expect(head.getByRole("searchbox")).toBeHidden();
});

test("print review: select all, assign one spool and report the rows it can't take, then stop tracking", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${id}`, {
    policies: [{ type: "prints", mode: "auto", frequency: "1h" }],
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });
  await seedProject(app.api);
  await page.goto(`/import/integration/${id}/prints`);
  const form = await openBulkEdit(page);
  await pick(form.getByRole("combobox", { name: "Project", exact: true }), "Set a value");
  await pick(form.getByRole("combobox", { name: "Value for Project" }), 1);
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Import \d+ rows?$/ })
    .click();
  await expect(page.getByText(/^Import finished/)).toBeVisible();
  await seedSpool(app.api, 15); // takes the 10 g slot, not the 20 and 30 g ones

  await page.goto("/prints/review");
  await page.getByRole("checkbox", { name: "Select all matching rows, on every page" }).click();
  await expect(page.getByText("3 selected")).toBeVisible();

  await page.getByRole("button", { name: "Assign a spool…" }).click();
  const dialog = page.getByRole("dialog");
  await pick(dialog.getByRole("combobox", { name: "Spool" }), 1);
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByText("Assigned 1 of 3")).toBeVisible();
  // The two it couldn't take stay selected.
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("button", { name: "Don't track", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Don't track" }).click();
  await expect(page.getByText("Nothing to review")).toBeVisible();
});
