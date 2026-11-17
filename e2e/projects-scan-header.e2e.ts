import { expect, test } from "./fixtures.ts";
import { addRoots } from "./helpers.ts";

// Scan folders lives in the page header, beside New project, at every width.
for (const [width, height] of [
  [1440, 900],
  [412, 915],
] as const) {
  test(`Scan folders sits beside New project at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/projects");
    const scan = page.getByRole("button", { name: "Scan folders" });
    const add = page.getByRole("link", { name: "New project" });
    await expect(scan).toBeVisible();
    await expect(add).toBeVisible();
    const [s, a] = [await scan.boundingBox(), await add.boundingBox()];
    if (!s || !a) throw new Error("header buttons have no box");
    // Same row: the vertical ranges overlap, and the scan button is not below New project.
    expect(s.y < a.y + a.height && a.y < s.y + s.height).toBe(true);
    // Only the page header holds it: no second Scan folders button.
    await expect(scan).toHaveCount(1);
  });
}

test("a scan reports its result below the header and the button is idle again", async ({
  page,
  app,
}) => {
  const root = app.makeProjectDir("Phoenix");
  await addRoots(app.api, root);
  await page.goto("/projects");
  // Nothing to report before a scan.
  await expect(page.getByText(/Scan finished:/)).toHaveCount(0);
  await page.getByRole("button", { name: "Scan folders" }).click();
  await expect(page.getByText(/Scan finished:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan folders" })).toBeEnabled();
  await expect(page.getByText("Phoenix").first()).toBeVisible();
});
