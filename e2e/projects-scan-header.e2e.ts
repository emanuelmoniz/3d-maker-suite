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

test("a viewer sees the Projects header without Scan folders or New project", async ({
  page,
  app,
}) => {
  const password = "correct horse";
  await app.api("POST", "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password,
  });
  await page.request.post("/api/auth/login", { data: { email: "ana@example.com", password } });
  await page.request.post("/api/users", {
    data: {
      displayName: "Vic Viewer",
      email: "vic@example.com",
      password,
      roleId: "00000000-0000-4000-8000-000000000003",
    },
  });
  await page.context().clearCookies();
  await page.request.post("/api/auth/login", { data: { email: "vic@example.com", password } });
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan folders" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);
});
