import { expect, test } from "./fixtures.ts";

test("searching a long list keeps the scroll position; a new page starts at the top", async ({
  page,
  app,
}) => {
  for (let i = 0; i < 40; i++) await app.api("POST", "/api/projects", { name: `Project ${i}` });
  await page.setViewportSize({ width: 1440, height: 400 });
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: /Project 39/ })).toBeVisible();

  // Scrolled a little, with the search box still on screen (as when a user types in it).
  await page.evaluate(() => window.scrollTo(0, 100));
  await page.getByRole("searchbox", { name: "Search projects" }).fill("Project");
  await expect(page).toHaveURL(/name=Project/);
  await expect(page.getByRole("link", { name: /Project 39/ })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(100);

  await page.getByRole("link", { name: "Prints" }).first().click();
  await expect(page).toHaveURL(/\/prints/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
