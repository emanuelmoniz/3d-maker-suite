import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { savedRoots } from "./helpers.ts";

test("project folder page: add one with a layout, the example follows, then edit it", async ({
  page,
  app,
}) => {
  const dir = join(app.dataDir, "models");
  mkdirSync(dir);
  await page.goto("/projects/settings");
  await page.getByRole("link", { name: "Add folder" }).click();
  await expect(page.getByRole("heading", { name: "Add project folder" })).toBeVisible();

  const example = page.getByRole("region", { name: "Example" });
  const item = (name: string) =>
    example
      .getByRole("listitem")
      .filter({ has: page.getByText(name, { exact: true }) })
      .last();
  await expect(example).toContainText("Every folder right inside designs is a project.");
  await page.getByRole("textbox", { name: "Folder path" }).fill(dir);
  await page.getByRole("radio", { name: "Projects inside a group folder" }).check();
  await page.getByRole("combobox", { name: "Files levels" }).selectOption("1");
  // The example names the real folder, puts the project under a group and stops listing at level 1.
  await expect(example).toContainText(
    "Projects sit 2 levels below models. Files up to 1 subfolder level down are listed.",
  );
  await expect(item("Furniture")).toContainText("group");
  await expect(item("014_shelf-bracket")).toContainText("project");
  await expect(item("cover.png")).not.toContainText("not listed");
  await expect(item("draft.png")).toContainText("not listed");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/projects\/settings\/folders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "models", level: 1 })).toBeVisible();
  expect(await savedRoots(app.api)).toEqual([
    { path: dir, projectDepth: 2, filesDepth: 1, autoSlice: true },
  ]);

  // Editing: the path stays, a depth change says what happens to the projects found so far.
  await expect(page.getByRole("textbox", { name: "Folder path" })).toHaveAttribute("readonly");
  await page.getByRole("radio", { name: "Every subfolder is a project" }).check();
  await expect(page.getByText("Projects already found stay as they are.")).toBeVisible();
  await page.getByRole("switch", { name: "Auto slice" }).click({ force: true });
  await page.getByRole("radio", { name: "Admins" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByText("Projects already found stay as they are.")).toHaveCount(0);
  expect(await savedRoots(app.api)).toEqual([
    { path: dir, projectDepth: 1, filesDepth: 1, autoSlice: false },
  ]);
  expect((await app.api<{ editBy: string }[]>("GET", "/api/roots"))[0]?.editBy).toBe("admins");

  // The settings list links to the page.
  await page.goto("/projects/settings");
  await page.getByRole("link", { name: `Edit ${dir}` }).click();
  await expect(page.getByRole("heading", { name: "models", level: 1 })).toBeVisible();
});
