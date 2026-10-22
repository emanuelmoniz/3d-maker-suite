import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { roots } from "./helpers.ts";

test("project folder: create and unlink on the edit page", async ({ page, app }) => {
  const root = join(app.dataDir, "models");
  mkdirSync(root, { recursive: true });
  await app.api("PATCH", "/api/preferences", { projectRoots: roots(root) });
  const p = await app.api<{ id: string }>("POST", "/api/projects", { name: "Idea" });

  await page.goto(`/projects/${p.id}/edit`);
  const card = page.getByRole("region", { name: "Project folder" });
  await card.getByRole("heading", { name: "Project folder" }).click();
  await expect(card.getByText("This project has no folder yet")).toBeVisible();
  await card.getByRole("button", { name: "Create folder" }).click();
  const folder = join(root, "001_Idea");
  await expect(card.getByRole("textbox", { name: "Folder" })).toHaveValue(folder);
  expect(existsSync(folder)).toBe(true);

  await card.getByRole("button", { name: "Unlink folder" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Unlink folder" }).click();
  await expect(card.getByText("This project has no folder yet")).toBeVisible();
  expect(existsSync(folder)).toBe(true);
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
  await app.api("PATCH", "/api/preferences", { projectRoots: roots(root) });
  const p = await app.api<{ id: string }>("POST", "/api/projects", {
    name: "Part",
    folderPath: gone,
  });
  rmSync(gone, { recursive: true });

  await page.goto(`/projects/${p.id}`);
  const banner = page.getByRole("alert").filter({ hasText: "The project folder was not found" });
  await expect(banner).toContainText(gone);
  await expect(page.getByRole("button", { name: "Open folder" })).toHaveCount(0);

  await banner.getByRole("button", { name: /^Browse for/ }).click();
  // Opens in the root the missing folder was in.
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: "Moved" }).click();
  await picker.getByRole("button", { name: "Select this folder" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open folder" })).toBeVisible();
});
