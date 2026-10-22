import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, offScreen, seedPrinter, seedRichProject } from "./helpers.ts";

// Phones in portrait: Pixel 9 Pro and iPhone 16 Pro Max.
for (const [width, height] of [
  [412, 915],
  [440, 956],
] as const) {
  test(`detail pages fit a ${width}px phone with the nav pinned`, async ({ page, app }) => {
    const project = await seedRichProject(app.api, app.dataDir);
    const printer = await seedPrinter(app.api);
    const accessory = await app.api<{ id: string }>("POST", "/api/accessories", {
      name: "AMS with a name long enough to wrap on a narrow phone screen",
      type: "AMS",
    });
    await app.api("POST", "/api/alerts/evaluate");
    const alerts = await app.api<{ id: string }[]>("GET", "/api/alerts");

    await page.setViewportSize({ width, height });
    const bad: string[] = [];
    for (const route of [
      `/projects/${project.id}`,
      `/printers/${printer.id}`,
      `/printers/accessories/${accessory.id}`,
      ...(alerts[0] ? [`/alerts/${alerts[0].id}`] : []),
    ]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 }), route).toBeVisible();
      if (await hasHorizontalScroll(page)) bad.push(`${route}: scrolls sideways`);
      for (const p of await offScreen(page)) bad.push(`${route}: ${p}`);
      const nav = await page.locator("nav.fixed, nav[class*='fixed']").last().boundingBox();
      if (!nav || Math.abs(nav.y + nav.height - height) > 1)
        bad.push(`${route}: bottom nav ends at ${nav ? nav.y + nav.height : "?"}, not ${height}`);
    }
    expect(bad).toEqual([]);
  });
}
