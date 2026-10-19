import { expect, test } from "./fixtures.ts";
import { seedProject } from "./helpers.ts";

test("quotes: numbered, client made on the costs page, open and edit, shown on project and client", async ({
  page,
  app,
}) => {
  const project = await seedProject(app.api, "Lamp");
  await page.goto("/costs");
  await expect(page.getByText("No saved quotes yet.")).toBeVisible();

  // A client created without leaving the calculator.
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Ana Silva");
  await dialog.getByLabel("Mobile").fill("911");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Client" })).toHaveValue("Ana Silva");

  await page.getByRole("combobox", { name: "Project", exact: true }).click();
  await page.getByRole("option", { name: "001-Lamp" }).click();
  await page.getByLabel("Prints").fill("3");
  await page.getByLabel("Quote name").fill("Desk lamp");
  await page.getByLabel("Notes").fill("Matte black");
  await page.getByRole("button", { name: "Save quote" }).click();
  await expect(page.getByText("Editing 001-Desk lamp")).toBeVisible();

  const table = page.getByRole("table", { name: "Saved quotes" });
  await expect(table.getByRole("link", { name: "001-Desk lamp" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Ana Silva" })).toBeVisible();

  // Edit it in place, then keep a copy as a second quote.
  await page.getByLabel("Notes").fill("Matte white");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await page.getByLabel("Quote name").fill("Desk lamp v2");
  await page.getByRole("button", { name: "Save as new" }).click();
  await expect(page.getByText("Editing 002-Desk lamp v2")).toBeVisible();
  await expect(table.getByRole("link", { name: /^00\d-Desk lamp/ })).toHaveCount(2);

  // Opening the first again restores what was saved.
  await table.getByRole("link", { name: "001-Desk lamp" }).click();
  await expect(page.getByText("Editing 001-Desk lamp")).toBeVisible();
  await expect(page.getByLabel("Notes")).toHaveValue("Matte white");
  await expect(page.getByLabel("Prints")).toHaveValue("3");

  await page.getByRole("button", { name: "Delete 002-Desk lamp v2" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(table.getByRole("link", { name: "002-Desk lamp v2" })).toHaveCount(0);

  await page.goto(`/projects/${project.id}`);
  await expect(
    page.getByRole("table", { name: "Saved quotes" }).getByRole("link", { name: "001-Desk lamp" }),
  ).toBeVisible();

  await page.goto("/clients");
  await page.getByRole("link", { name: "Ana Silva" }).click();
  const clientQuotes = page.getByRole("table", { name: "Saved quotes" });
  await clientQuotes.getByRole("link", { name: "001-Desk lamp" }).click();
  await expect(page).toHaveURL(/\/costs\?.*quote=/);
  await expect(page.getByText("Editing 001-Desk lamp")).toBeVisible();
});
