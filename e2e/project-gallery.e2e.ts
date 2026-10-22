import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, openSections } from "./helpers.ts";

const VIEWPORTS = [
  { width: 375, height: 800 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

for (const viewport of VIEWPORTS) {
  test(`project gallery: pick, search, view at ${viewport.width}px`, async ({ page, app }) => {
    const root = app.makeProjectDir("001_Vase");
    const dir = join(root, "001_Vase");
    for (const n of ["front.png", "back.png", "side.png"]) writeFileSync(join(dir, n), PNG);
    mkdirSync(join(dir, "pics"));
    writeFileSync(join(dir, "pics", "top.png"), PNG);
    await app.api("PATCH", "/api/preferences", { projectRoots: [root] });
    await app.api("POST", "/api/projects/scan");
    const list = () => app.api<{ items: { id: string }[] }>("GET", "/api/projects");
    await expect.poll(async () => (await list()).items.length).toBe(1);
    const id = (await list()).items[0]?.id;
    const files = async () =>
      (await app.api<{ meta: { files: unknown[] } }>("GET", `/api/projects/${id}`)).meta.files
        .length;
    await expect.poll(files).toBeGreaterThanOrEqual(3);
    await page.setViewportSize(viewport);

    // Edit page: search, add to the selected section (it leaves the available list), preview both.
    await page.goto(`/projects/${id}/edit`);
    await openSections(page, "Preview and gallery");
    const selected = page.getByRole("region", { name: /^Selected images/ });
    const available = page.getByRole("region", { name: /^Available images/ });
    await expect(selected.getByText("No images selected yet")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search images" }).fill("front");
    await expect(available.getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "Add shown" }).click();
    await expect(selected.getByRole("listitem")).toHaveCount(1);
    await expect(available.getByRole("listitem")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search images" }).fill("");
    await available.getByRole("button", { name: "Preview back.png" }).click();
    await expect(page.getByRole("dialog", { name: "back.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await available.getByRole("button", { name: "Add side.png to the gallery" }).click();
    await selected.getByRole("button", { name: "Preview side.png" }).click();
    await expect(page.getByRole("dialog", { name: "side.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await selected.getByRole("button", { name: "Use front.png as the cover" }).click();

    // Browse only chosen folders.
    await page.getByRole("radio", { name: "Images from selected folders" }).check();
    await expect(page.getByText("Pick a folder to see its images.")).toBeVisible();
    await page.getByRole("searchbox", { name: "Folders" }).focus();
    await page.getByRole("button", { name: "pics", exact: true }).click();
    await expect(available.getByText("pics/top.png")).toBeVisible();
    await expect(available.getByText("back.png")).toBeHidden();
    await page.getByRole("radio", { name: "All available images" }).check();
    await expect(available.getByText("back.png")).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.screenshot({ path: `test-results/gallery-edit-${viewport.width}.png` });
    await page.getByRole("button", { name: "Save" }).click();

    // Detail page: section opens by keyboard, viewer navigates, zooms and closes.
    const gallery = page.getByRole("region", { name: "Gallery (2)" });
    await gallery.locator("summary").focus();
    await page.keyboard.press("Enter");
    await gallery.getByRole("button", { name: "Open front.png" }).click();
    const viewer = page.getByRole("dialog", { name: "front.png" });
    await expect(viewer).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: "side.png" })).toBeVisible();
    await page.keyboard.press("+");
    await expect(page.getByRole("button", { name: "Reset zoom" })).toBeEnabled();
    await page.getByRole("button", { name: "Previous image" }).click();
    await expect(page.getByRole("dialog", { name: "front.png" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset zoom" })).toBeDisabled();
    await page.screenshot({ path: `test-results/gallery-viewer-${viewport.width}.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.screenshot({ path: `test-results/gallery-detail-${viewport.width}.png` });
  });
}
