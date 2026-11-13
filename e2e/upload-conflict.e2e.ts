import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll } from "./helpers.ts";

test("upload over a file: a conflict copy when it changed since the list, else a version (375px)", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  // The hub needs accounts.
  await page.goto("/");
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Admin", email: "ana@example.com", password: "correct horse" },
  });
  const prefs = await page.request.patch("/api/preferences", {
    data: { hubEnabled: true, hubVersions: true },
  });
  expect(prefs.ok()).toBe(true);
  const hubDir = join(app.dataDir, "hub-models");
  mkdirSync(hubDir, { recursive: true });
  await page.request.post("/api/roots", { data: { path: hubDir } });
  const vase = await (
    await page.request.post("/api/projects", { data: { name: "Vase", createFolder: true } })
  ).json();
  const notes = join(vase.folderPath, "notes.txt");
  writeFileSync(notes, "v1");

  await page.goto(`/projects/${vase.id}`);
  const files = page.getByRole("region", { name: "Files" });
  await files.locator("summary").click();
  await expect(files.getByText("notes.txt")).toBeVisible();
  const replace = (text: string) =>
    files
      .locator("li", { hasText: "notes.txt" })
      .locator('input[type="file"]')
      .setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from(text) });

  // Changed on the disk after the list loaded: the upload is kept beside it, the file stays.
  writeFileSync(notes, "changed elsewhere");
  await replace("mine");
  await expect(files.getByRole("status")).toContainText("was kept as notes (conflict Ana Admin");
  expect(readFileSync(notes, "utf8")).toBe("changed elsewhere");
  const copy = readdirSync(vase.folderPath).find((n) => n.startsWith("notes (conflict "));
  expect(copy && readFileSync(join(vase.folderPath, copy), "utf8")).toBe("mine");
  expect(await hasHorizontalScroll(page)).toBe(false);

  // From the fresh list: replaced, and the old content is a version.
  await page.reload();
  await files.locator("summary").click();
  await expect(files.getByText("notes.txt", { exact: true })).toBeVisible();
  await replace("v2");
  await expect.poll(() => readFileSync(notes, "utf8")).toBe("v2");
  await expect(files.getByRole("status")).toBeHidden();
  await files.getByRole("button", { name: "Versions of notes.txt" }).click();
  // Version 2: the change made on the disk, which this upload replaced.
  await expect(page.getByRole("dialog").getByRole("row", { name: /^2 The hub/ })).toBeVisible();
});
