import { docsUrl } from "../packages/core/src/links.ts";
import { wikiTarget } from "../packages/core/src/wikiRoutes.ts";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, seedPrinter } from "./helpers.ts";

// Step 3 of Plan 6.2.0: the page header's Help icon stays on screen from 320 to 1440 px, works by
// keyboard, is named "Help", and its address is the route map's entry for the open screen.
const WIDTHS = [320, 412, 768, 1024, 1440];
const PAGES = ["/", "/printers", "/printers/$id", "/projects", "/filament", "/settings"];

for (const width of WIDTHS) {
  test(`Help icon is on screen, named and mapped at ${width}px`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 900 });
    const printer = await seedPrinter(app.api);
    for (const route of PAGES) {
      const path = route.replace("$id", printer.id);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const help = page.getByRole("link", { name: "Help", exact: true });
      await expect(help, path).toHaveCount(1);
      await expect(help, path).toBeInViewport({ ratio: 1 });

      const target = wikiTarget(route === "/" ? "/" : route);
      expect(target, `${route} has a map entry`).toBeDefined();
      if (target) await expect(help).toHaveAttribute("href", docsUrl(target.page, target.section));
      expect(await hasHorizontalScroll(page), `${path} scrolls sideways`).toBe(false);
    }
  });
}

test("Help icon works by keyboard", async ({ page, app }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/printers");
  const help = page.getByRole("link", { name: "Help", exact: true });
  await help.focus();
  await expect(help).toBeFocused();
  const [guide] = await Promise.all([
    page.context().waitForEvent("page"),
    page.keyboard.press("Enter"),
  ]);
  const target = wikiTarget("/printers");
  expect(target).toBeDefined();
  if (target)
    await expect(guide).toHaveURL(new URL(docsUrl(target.page, target.section), app.url).href);
  await guide.close();
});
