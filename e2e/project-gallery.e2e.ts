import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll } from "./helpers.ts";

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

    // Edit page: search narrows the grid, pick two, preview one, star it as the cover.
    await page.goto(`/projects/${id}/edit`);
    await page.getByRole("searchbox", { name: "Search images" }).fill("front");
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await page.getByRole("button", { name: "Add shown" }).click();
    await page.getByRole("button", { name: "Preview front.png" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("searchbox", { name: "Search images" }).fill("");
    await page.getByRole("checkbox", { name: "side.png" }).check();
    await page.getByRole("button", { name: "Use front.png as the cover" }).click();
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
