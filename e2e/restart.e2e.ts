import { expect, test } from "./fixtures.ts";

test("restart: an overlay blocks the page until a new process answers, then it reloads; no new tab", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // The old process answers until it's gone, then a proxy error, then the new one.
  let server: "old" | "down" | "new" = "old";
  await page.route("**/api/health", (r) =>
    server === "down"
      ? r.fulfill({ status: 502, body: "" })
      : r.fulfill({
          json: { status: "ok", version: "1.0.0", startedAt: server === "old" ? "A" : "B" },
        }),
  );
  await page.goto("/settings");
  let restarted = false;
  await page.route("**/api/server-config/restart", (r) => {
    restarted = true;
    return r.fulfill({ json: {} });
  });
  const opened: unknown[] = [];
  context.on("page", (p) => opened.push(p));
  let loads = 0;
  page.on("load", () => loads++);

  await page.getByRole("button", { name: "Restart server" }).click();
  const overlay = page.getByRole("dialog", { name: /The server is restarting/ });
  await expect(overlay).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(overlay).toBeVisible();

  // The old process still answering isn't "back"; neither is the proxy error.
  await page.waitForRequest("**/api/health");
  await page.waitForRequest("**/api/health");
  server = "down";
  await page.waitForRequest("**/api/health");
  expect(loads).toBe(0);
  await expect(overlay).toBeVisible();

  const reloaded = page.waitForEvent("load");
  server = "new";
  await reloaded;
  expect(restarted).toBe(true);
  expect(opened).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Restart server" })).toBeVisible();
  await expect(overlay).toHaveCount(0);
});
