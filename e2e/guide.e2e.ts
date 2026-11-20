import { expect, test } from "./fixtures.ts";

// Step 0b of Plan 6.2.0: the guide ships with the app at /guide/ (built by `pnpm guide:build`, which
// `pnpm test:e2e` runs). It opens with no sign-in and no network, at an exact section.
test("the guide opens from the app with no sign-in and no internet, at a section", async ({
  page,
  app,
}) => {
  await app.api("POST", "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: "correct horse",
  });
  // Signed out now: nothing but this server answers.
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(app.url)) return route.continue();
    outside.push(route.request().url());
    return route.abort();
  });

  await page.goto(`${app.url}/guide/Printers#add-or-edit-a-printer`);
  await expect(page.getByRole("heading", { level: 1, name: "Printers" })).toBeVisible();
  await expect(page).toHaveURL(/\/guide\/Printers#add-or-edit-a-printer$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Add or edit a printer" }),
  ).toBeInViewport();
  // The screenshots are the converted ones, and they load.
  const image = page.getByRole("img", { name: "The add printer form" });
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute("src", /\.webp$/);
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // This version, and the way to the newest.
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar.getByRole("link", { name: /^Version \d+\.\d+\.\d+/ })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Newest version online" })).toHaveAttribute(
    "href",
    /^https:\/\/emanuelmoniz\.github\.io\/3d-maker-suite\/?$/,
  );
  expect(outside).toEqual([]);
});
