import { expect, test } from "./fixtures.ts";

test("restart: banner in the same tab, then the page reloads; no new tab", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");
  let restarted = false;
  await page.route("**/api/server-config/restart", (r) => {
    restarted = true;
    return r.fulfill({ json: {} });
  });
  const opened: unknown[] = [];
  context.on("page", (p) => opened.push(p));
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Restart server" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "The server is restarting" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Restart server" })).toBeVisible();
  await reloaded;
  expect(restarted).toBe(true);
  expect(opened).toHaveLength(0);
});
