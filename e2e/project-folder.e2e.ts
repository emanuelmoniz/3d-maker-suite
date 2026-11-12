import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { addRoots, hasHorizontalScroll, pick, seedPrinter } from "./helpers.ts";

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
  await expect(dialog).toContainText("1 print");

  // With the print on No project, the project and its (empty) folder go.
  await app.api("PATCH", `/api/prints/${print.id}`, { projectId: null });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
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

test("change projects' root: moves the selection, reports a conflict, touches no file", async ({
  page,
  app,
}) => {
  const from = join(app.dataDir, "old");
  const to = join(app.dataDir, "new");
  for (const d of [join(from, "One"), join(from, "Two"), join(to, "Two")]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "part.stl"), "solid");
  }
  await addRoots(app.api, from, to);
  for (const [name, folderPath] of [
    ["One", join(from, "One")],
    ["Two", join(from, "Two")],
    ["Holder", join(to, "Two")],
  ])
    await app.api("POST", "/api/projects", { name, folderPath });
  // The user moves One's files.
  renameSync(join(from, "One"), join(to, "One"));

  await page.goto("/projects/settings");
  await page.getByRole("button", { name: "Change project folder…" }).click();
  const dialog = page.getByRole("dialog", { name: "Change project folder", exact: true });
  const row = (name: string) => dialog.getByRole("row").filter({ hasText: name });
  await expect(row("001-One")).toContainText("Missing");

  // Only the old root's projects, selected from the keyboard.
  const head = dialog.getByRole("columnheader").filter({ hasText: "Project folder" });
  await head.getByRole("button", { name: /^Filter by/ }).click();
  await head.getByLabel(from).check();
  await head.getByRole("button", { name: "Apply" }).click();
  await expect(dialog.getByRole("row")).toHaveCount(3); // header + 2
  const all = dialog.getByRole("checkbox", { name: "Select all 2 projects shown" });
  await all.focus();
  await page.keyboard.press("Space");
  await expect(all).toBeChecked();
  await expect(dialog.getByText("2 selected")).toBeVisible();

  await dialog.getByRole("button", { name: "Change folder…" }).click();
  const form = page.getByRole("dialog", { name: "Change folder of 2 projects" });
  // Nothing to change it to yet: the browser asks for a root.
  await form.getByRole("button", { name: "Change folder", exact: true }).click();
  await expect(form).toBeVisible();
  await pick(form.getByRole("combobox", { name: "New project folder" }), to);
  await expect(form.getByText(`to ${to}?`)).toBeVisible();
  await form.getByRole("button", { name: "Change folder", exact: true }).click();
  await expect(form).toBeHidden();

  const summary = dialog.getByRole("status").filter({ hasText: "skipped" });
  await expect(summary).toContainText("1 project changed.");
  await expect(summary).toContainText("002-Two: 003-Holder already uses that folder.");
  // The one it couldn't do stays selected.
  await expect(dialog.getByText("1 selected")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Select 002-Two" })).toBeChecked();

  // The message can go; the selection stays until a new filter ends it.
  await dialog.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(summary).toHaveCount(0);
  await expect(dialog.getByText("1 selected")).toBeVisible();

  // One now reads OK on the new root; Two stayed. Files are where the user left them.
  await dialog.getByRole("button", { name: "Clear filters" }).click();
  await expect(dialog.getByText("1 selected")).toHaveCount(0);
  await expect(row("001-One")).toContainText(to);
  await expect(row("001-One")).toContainText("OK");
  await expect(row("002-Two")).toContainText(from);
  expect(existsSync(join(to, "One", "part.stl"))).toBe(true);
  expect(existsSync(join(from, "Two", "part.stl"))).toBe(true);
  expect(existsSync(join(from, "One"))).toBe(false);

  // Unlink folders: the project leaves the table, its folder stays on disk.
  await dialog.getByRole("checkbox", { name: "Select 002-Two" }).check();
  await dialog.getByRole("button", { name: "Unlink 1 folder" }).click();
  const ask = dialog.getByRole("dialog");
  await expect(ask).toContainText("Unlink the folder of 1 project?");
  await ask.getByRole("button", { name: "Unlink folder" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "1 project unlinked." })).toBeVisible();
  await expect(row("002-Two")).toHaveCount(0);
  expect(existsSync(join(from, "Two", "part.stl"))).toBe(true);

  // Phone: the table scrolls inside the dialog, not the page.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("change project folder: Move files takes the files to the new root", async ({ page, app }) => {
  const from = join(app.dataDir, "old");
  const to = join(app.dataDir, "new");
  mkdirSync(join(from, "sub", "Part"), { recursive: true });
  mkdirSync(to);
  writeFileSync(join(from, "sub", "Part", "part.stl"), "solid");
  await addRoots(app.api, from, to);
  await app.api("POST", "/api/projects", { name: "Part", folderPath: join(from, "sub", "Part") });

  await page.goto("/projects/settings");
  await page.getByRole("button", { name: "Change project folder…" }).click();
  const dialog = page.getByRole("dialog", { name: "Change project folder", exact: true });
  await dialog.getByRole("checkbox", { name: "Select 001-Part" }).check();
  await dialog.getByRole("button", { name: "Change folder…" }).click();
  const form = page.getByRole("dialog", { name: "Change folder of 1 project" });
  await pick(form.getByRole("combobox", { name: "New project folder" }), to);
  await form.getByRole("checkbox", { name: "Move files" }).check();
  await expect(form.getByText("and move its files there?")).toBeVisible();
  await form.getByRole("button", { name: "Change folder", exact: true }).click();

  await expect(dialog.getByRole("status").filter({ hasText: "changed" })).toContainText(
    "1 project changed.",
  );
  await expect(dialog.getByText(/\d+ selected/)).toHaveCount(0);
  const row = dialog.getByRole("row").filter({ hasText: "001-Part" });
  await expect(row).toContainText(to);
  await expect(row).toContainText("OK");
  expect(existsSync(join(to, "sub", "Part", "part.stl"))).toBe(true);
  expect(existsSync(join(from, "sub", "Part"))).toBe(false);
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
