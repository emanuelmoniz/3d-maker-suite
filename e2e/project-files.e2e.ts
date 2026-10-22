import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, pick, roots } from "./helpers.ts";

const VIEWPORTS = [
  { width: 375, height: 800 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test(`project files: create project in a chosen root, then manage its files at ${viewport.width}px`, async ({
    page,
    app,
  }) => {
    const a = join(app.dataDir, "root-a");
    const b = join(app.dataDir, "root-b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    await app.api("PATCH", "/api/preferences", { projectRoots: roots(a, b) });
    await page.setViewportSize(viewport);

    // New project: asks for the root, creates the folder, opens the project.
    await page.goto("/projects/new");
    await page.getByLabel("Name", { exact: true }).fill("Vase");
    await pick(page.getByRole("combobox", { name: "Create the project folder in" }), b);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Vase" })).toBeVisible();
    const folder = join(b, "001_Vase");
    expect(existsSync(folder)).toBe(true);

    const files = page.getByRole("region", { name: "Files" });
    const confirm = (name: string) => page.getByRole("dialog").getByRole("button", { name });
    // Sections start closed: open with the keyboard.
    await expect(files.getByRole("button", { name: "New folder", exact: true })).toBeHidden();
    await files.locator("summary").focus();
    await page.keyboard.press("Enter");

    // Upload by picker.
    await files
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("v1"),
      });
    await expect(files.getByText("notes.txt")).toBeVisible();
    expect(readFileSync(join(folder, "notes.txt"), "utf8")).toBe("v1");

    // Same name again asks before replacing; cancel keeps the file.
    const again = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("v2") };
    await files.locator('input[type="file"]').first().setInputFiles(again);
    await expect(page.getByRole("heading", { name: "Replace existing file?" })).toBeVisible();
    await confirm("Cancel").click();
    expect(readFileSync(join(folder, "notes.txt"), "utf8")).toBe("v1");
    await files.locator('input[type="file"]').first().setInputFiles(again);
    await confirm("Replace").click();
    await expect.poll(() => readFileSync(join(folder, "notes.txt"), "utf8")).toBe("v2");
    await page.waitForLoadState("networkidle");

    // Replace from the row.
    await files
      .locator("li", { hasText: "notes.txt" })
      .locator('input[type="file"]')
      .setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("v3") });
    await expect.poll(() => readFileSync(join(folder, "notes.txt"), "utf8")).toBe("v3");

    // New folder, upload into it, rename it, move the file out, delete the folder.
    await files.getByRole("button", { name: "New folder", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("parts");
    await confirm("Create").click();
    await expect(files.getByRole("button", { name: "parts", exact: true })).toBeVisible();
    expect(existsSync(join(folder, "parts"))).toBe(true);

    await files.getByRole("button", { name: "Move notes.txt" }).click();
    await pick(
      page.getByRole("dialog").getByRole("combobox", { name: "Destination folder" }),
      "parts",
    );
    await confirm("Move").click();
    await expect.poll(() => existsSync(join(folder, "parts", "notes.txt"))).toBe(true);

    await files.getByRole("button", { name: "Rename parts" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("stl");
    await confirm("Rename").click();
    await expect(files.getByRole("button", { name: "stl", exact: true })).toBeVisible();
    expect(existsSync(join(folder, "stl", "notes.txt"))).toBe(true);

    await files.getByRole("button", { name: "stl", exact: true }).click();
    await expect(files.getByText("notes.txt")).toBeVisible();
    await files.getByRole("button", { name: "Upload into stl" }).click();
    expect(await hasHorizontalScroll(page)).toBe(false);

    await files.getByRole("button", { name: "Delete stl" }).click();
    await page.getByRole("heading", { name: "Delete stl?" }).waitFor();
    await confirm("Delete").click();
    await expect(files.getByRole("button", { name: "stl", exact: true })).toHaveCount(0);
    expect(existsSync(join(folder, "stl"))).toBe(false);
    expect(existsSync(join(b, ".3d-maker-suite-trash"))).toBe(true);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
}

test("project files: a name that is not allowed shows an error", async ({ page, app }) => {
  const root = join(app.dataDir, "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".keep"), "");
  await app.api("PATCH", "/api/preferences", { projectRoots: roots(root) });
  const p = await app.api<{ id: string }>("POST", "/api/projects", {
    name: "Bad",
    createFolder: true,
  });
  await page.goto(`/projects/${p.id}`);
  const files = page.getByRole("region", { name: "Files" });
  await files.getByRole("heading", { name: "Files" }).click();
  await files.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("a:b");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(files.getByRole("alert")).toBeVisible();
});

test("project files: select items and move or remove them in bulk", async ({ page, app }) => {
  const root = join(app.dataDir, "root");
  const dir = join(root, "001_Bulk");
  mkdirSync(join(dir, "dest"), { recursive: true });
  for (const f of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(dir, f), f);
  writeFileSync(join(dir, "dest", "c.txt"), "already there");
  await app.api("PATCH", "/api/preferences", { projectRoots: roots(root) });
  const p = await app.api<{ id: string }>("POST", "/api/projects", {
    name: "Bulk",
    folderPath: dir,
  });
  await page.goto(`/projects/${p.id}`);
  const files = page.getByRole("region", { name: "Files" });
  await files.getByRole("heading", { name: "Files" }).click();
  const dialog = page.getByRole("dialog");
  const move = files.getByRole("button", { name: "Move", exact: true });
  const remove = files.getByRole("button", { name: "Remove", exact: true });
  await expect(move).toBeDisabled();
  await expect(remove).toBeDisabled();

  // Move a and c into dest: c already exists there, so only a moves and c stays selected.
  await files.getByRole("checkbox", { name: "Select a.txt" }).check();
  await files.getByRole("checkbox", { name: "Select c.txt" }).check();
  await expect(files.getByText("2 selected")).toBeVisible();
  await move.click();
  await pick(dialog.getByRole("combobox", { name: "Destination folder" }), "dest");
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(files.getByRole("alert")).toContainText("1 item could not be changed");
  expect(existsSync(join(dir, "dest", "a.txt"))).toBe(true);
  expect(readFileSync(join(dir, "dest", "c.txt"), "utf8")).toBe("already there");
  await expect(files.getByText("1 selected")).toBeVisible();

  // Select all, remove everything.
  await files.getByRole("checkbox", { name: "Select all" }).check();
  await remove.click();
  await expect(page.getByRole("heading", { name: "Remove 3 items?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(files.getByText("b.txt")).toHaveCount(0);
  expect(existsSync(join(dir, "b.txt"))).toBe(false);
  expect(existsSync(join(dir, "dest"))).toBe(false);
});
