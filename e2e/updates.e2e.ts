import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";

const version: string = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
).version;

test("updates: version in the footer and About; Docker gets the command, git the button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");
  await expect(page.locator("footer").getByText(`v${version}`, { exact: false })).toBeVisible();
  const about = page.locator("#updates");
  await expect(about.getByRole("heading", { name: "About & updates" })).toBeVisible();
  await expect(about.getByText(`Version ${version}`)).toBeVisible();
  // The e2e server isn't started by the launcher: no Update button, ever.
  await expect(about.getByRole("button", { name: /^Update to/ })).toHaveCount(0);

  // The release list comes from GitHub; stand in for the server's answer.
  const answer = (install: string) =>
    page.route("**/api/updates", (r) =>
      r.fulfill({
        json: {
          version,
          install,
          latest: { tag: "v99.0.0", url: "https://example.com/notes" },
          checkedAt: new Date().toISOString(),
          checkFailed: false,
          history: [],
        },
      }),
    );
  await answer("docker");
  await page.reload();
  await expect(about.getByText("Version 99.0.0 is available.")).toBeVisible();
  await expect(about.getByText("docker compose pull")).toBeVisible();
  await expect(about.getByRole("button", { name: "Update to 99.0.0" })).toHaveCount(0);

  await page.unroute("**/api/updates");
  await answer("git");
  await page.reload();
  await expect(about.getByRole("button", { name: "Update to 99.0.0" })).toBeVisible();
  await expect(about.getByText("docker compose pull")).toHaveCount(0);
});

test("updates: the banner reads on any page and leads to Settings", async ({ page }) => {
  // The shell renders before a page loads its own translations: start where Settings isn't loaded.
  await page.route("**/api/alerts", (r) =>
    r.fulfill({
      json: [
        {
          id: "a1",
          kind: "update_available",
          severity: "success",
          module: "system",
          task: "update",
          entityType: "release",
          entityId: "v99.0.0",
          context: { version: "99.0.0" },
          createdAt: new Date().toISOString(),
          readAt: null,
          notifiedAt: null,
          snoozedUntil: null,
          dismissedAt: null,
          resolvedAt: null,
          updatedAt: null,
          hasDetail: false,
        },
      ],
    }),
  );
  await page.goto("/");
  const banner = page.getByRole("status").filter({ hasText: "Version 99.0.0 is available" });
  await expect(banner).toBeVisible();
  await banner.getByRole("link", { name: "See update" }).click();
  await expect(page).toHaveURL(/\/settings#updates$/);
  await expect(page.locator("#updates")).toBeVisible();
});
