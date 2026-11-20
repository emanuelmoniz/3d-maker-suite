import { expect, test } from "./fixtures.ts";
import { seedPrinter } from "./helpers.ts";

// Step 1 of Plan 6.2.0: the page header's Help icon opens the guide section for the open screen
// (packages/core/src/wikiRoutes.ts), in the copy the app serves at /guide/, in a new tab. Settings
// tabs show one icon: the Settings header's, pointing at the open tab.
const PAGES = [
  { path: "/printers", url: "/guide/Printers#printers-list", heading: "Printers list" },
  { path: "/printers/:id", url: "/guide/Printers#printer-details", heading: "Printer details" },
  {
    path: "/projects/settings/sources",
    url: "/guide/Projects-Settings#sources",
    heading: "Sources",
  },
  { path: "/settings", url: "/guide/Settings-General#general", heading: "General" },
  { path: "/settings/logs", url: "/guide/Logs#logs-tab", heading: "Logs tab" },
];

for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["phone", 412, 915],
] as const) {
  test(`Help opens the screen's guide section at ${name} width`, async ({ page, app }) => {
    await page.setViewportSize({ width, height });
    const printer = await seedPrinter(app.api);
    for (const { path, url, heading } of PAGES) {
      await page.goto(path.replace(":id", printer.id));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const help = page.getByRole("link", { name: "Help", exact: true });
      // One icon, also on a Settings tab, outside the heading.
      await expect(help, path).toHaveCount(1);
      await expect(help).toHaveAttribute("href", url);
      await expect(help).toHaveAttribute("target", "_blank");
      await expect(help).toHaveAttribute("rel", "noreferrer");
      await expect(page.getByRole("heading", { level: 1 }).getByRole("link")).toHaveCount(0);
      const box = await help.boundingBox();
      expect(box?.width ?? 0, path).toBeGreaterThanOrEqual(36);
      expect(box?.height ?? 0, path).toBeGreaterThanOrEqual(36);
      expect((box?.x ?? 0) + (box?.width ?? 0), path).toBeLessThanOrEqual(width);

      const [guide] = await Promise.all([page.context().waitForEvent("page"), help.click()]);
      await expect(guide).toHaveURL(new URL(url, app.url).href);
      await expect(guide.getByRole("heading", { level: 2, name: heading })).toBeInViewport();
      await guide.close();
    }
  });
}
