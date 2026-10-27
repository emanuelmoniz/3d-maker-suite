import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { addRoots, seedPrinter } from "./helpers.ts";

test("project folder: create and unlink on the edit page", async ({ page, app }) => {
  const root = join(app.dataDir, "models");
  mkdirSync(root, { recursive: true });
  await addRoots(app.api, root);
  const p = await app.api<{ id: string }>("POST", "/api/projects", { name: "Idea" });

  await page.goto(`/projects/${p.id}/edit`);
  const card = page.getByRole("region", { name: "Project folder" });
  await card.getByRole("heading", { name: "Project folder" }).click();
  await expect(card.getByText("This project has no folder yet")).toBeVisible();
  await card.getByRole("button", { name: "Create folder" }).click();
  const folder = join(root, "001_Idea");
  await expect(card.getByRole("textbox", { name: "Folder" })).toHaveValue(folder);
  expect(existsSync(folder)).toBe(true);

  // Unlink and keep (the default): nothing moves, and it can be linked again in one click.
  const dialog = page.getByRole("dialog");
  await card.getByRole("button", { name: "Unlink folder" }).click();
  await expect(dialog.getByRole("radio", { name: "Keep it as it is" })).toBeChecked();
  await dialog.getByRole("button", { name: "Unlink folder" }).click();
  await expect(card.getByText(`Unlinked from ${join("models", "001_Idea")}`)).toBeVisible();
  expect(existsSync(folder)).toBe(true);
  await card.getByRole("button", { name: "Link it again" }).click();
  await expect(card.getByRole("textbox", { name: "Folder" })).toHaveValue(folder);

  // Unlink to the trash: the folder moves into the root's trash, and the page says where.
  await card.getByRole("button", { name: "Unlink folder" }).click();
  await dialog.getByRole("radio", { name: "Move it to the trash" }).check();
  await expect(dialog).toContainText(join("models", ".3d-maker-suite-trash"));
  await dialog.getByRole("button", { name: "Unlink folder" }).click();
  await expect(card.getByRole("status")).toContainText(join("models", ".3d-maker-suite-trash"));
  await expect(card.getByText("This project has no folder yet")).toBeVisible();
  expect(existsSync(folder)).toBe(false);
});

test("delete project: refused while it has prints, then goes with its empty folder", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  mkdirSync(root, { recursive: true });
  await addRoots(app.api, root);
  const p = await app.api<{ id: string; folderPath: string }>("POST", "/api/projects", {
    name: "Gone",
    createFolder: true,
  });
  const printer = await seedPrinter(app.api);
  const print = await app.api<{ id: string }>("POST", "/api/prints", {
    printerId: printer.id,
    projectId: p.id,
    startedAt: new Date().toISOString(),
    usages: [],
    title: "Calibration",
    outcome: "success",
  });

  await page.goto(`/projects/${p.id}`);
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByRole("alert")).toContainText("It has prints");

  // With the print on No project, the project and its (empty) folder go.
  await app.api("PATCH", `/api/prints/${print.id}`, { projectId: null });
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(existsSync(p.folderPath)).toBe(false);

  // The print stays, shown as No project, and the project filter finds it.
  await page.goto("/prints");
  const row = page.getByRole("row").filter({ hasText: "Calibration" });
  await expect(row.getByText("No project")).toHaveClass(/text-muted/);
  const head = page.getByRole("columnheader").filter({ hasText: "Project" });
  await head.getByRole("button", { name: /^Filter by/ }).click();
  await head.getByLabel("No project").check();
  await head.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("row")).toHaveCount(2); // header + the print
});

test("project folder: a missing folder shows a banner, linking another fixes it", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  const gone = join(root, "Gone");
  const moved = join(root, "Moved");
  for (const d of [gone, moved]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "part.stl"), "solid");
  }
  await addRoots(app.api, root);
  const p = await app.api<{ id: string }>("POST", "/api/projects", {
    name: "Part",
    folderPath: gone,
  });
  rmSync(gone, { recursive: true });

  await page.goto(`/projects/${p.id}`);
  const banner = page.getByRole("alert").filter({ hasText: "The project folder was not found" });
  await expect(banner).toContainText(join("models", basename(gone)));
  await expect(page.getByRole("button", { name: "Open folder" })).toHaveCount(0);

  await banner.getByRole("button", { name: /^Browse for/ }).click();
  // Opens in the root the missing folder was in.
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: "Moved" }).click();
  await picker.getByRole("button", { name: "Select this folder" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open folder" })).toBeVisible();
});

test("folder picker on the edit page: New folder stays in the dialog and creates it", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  mkdirSync(root, { recursive: true });
  await addRoots(app.api, root);
  const p = await app.api<{ id: string }>("POST", "/api/projects", {
    name: "Idea",
    createFolder: true,
  });

  await page.goto(`/projects/${p.id}/edit`);
  const card = page.getByRole("region", { name: "Project folder" });
  await card.getByRole("heading", { name: "Project folder" }).click();
  await card.getByRole("button", { name: /^Browse for/ }).click();
  const picker = page.getByRole("dialog", { name: "Project folder" });
  await picker.getByRole("button", { name: "New folder" }).click();
  await picker.getByRole("textbox", { name: "New folder name" }).fill("Elsewhere");
  await picker.getByRole("textbox", { name: "New folder name" }).press("Enter");
  await expect(picker.getByRole("button", { name: "Elsewhere" })).toBeVisible();
  expect(existsSync(join(root, "Elsewhere"))).toBe(true);
  await expect(picker).toBeVisible();
});
