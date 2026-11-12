import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";

const version: string = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
).version;

test("updates: version in the footer and About; Docker gets the command, git and bundles the button", async ({
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
  const answer = (install: string, history: object[] = []) =>
    page.route("**/api/updates", (r) =>
      r.fulfill({
        json: {
          version,
          install,
          latest: { tag: "v99.0.0", url: "https://example.com/notes" },
          checkedAt: new Date().toISOString(),
          checkFailed: false,
          history,
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

  // An installed app: same button; a release that needs a newer Node points to the installer.
  await page.unroute("**/api/updates");
  await answer("bundle", [
    {
      action: "update",
      at: new Date().toISOString(),
      fromVersion: version,
      toVersion: "98.0.0",
      fromSha: version,
      backup: "update-1.zip",
      ok: false,
      failedStep: "start",
      canRollBack: false,
    },
  ]);
  await page.route("**/api/updates/apply", (r) =>
    r.fulfill({
      status: 409,
      json: { error: { code: "needs_installer", message: "x" } },
    }),
  );
  await page.reload();
  await expect(about.getByText("failed while starting the new version")).toBeVisible();
  await about.getByRole("button", { name: "Update to 99.0.0" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Update to 99.0.0" }).click();
  await expect(about.getByRole("alert")).toContainText("Download its installer");
});

test("updates: an overlay blocks the page; a failed update closes it and About says why", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let failed = false;
  await page.route("**/api/updates", (r) =>
    r.fulfill({
      json: {
        version,
        install: "bundle",
        latest: { tag: "v99.0.0", url: "https://example.com/notes" },
        checkedAt: new Date().toISOString(),
        checkFailed: false,
        history: failed
          ? [
              {
                action: "update",
                at: new Date().toISOString(),
                fromVersion: version,
                toVersion: "99.0.0",
                fromSha: version,
                backup: "update-1.zip",
                ok: false,
                failedStep: "build",
                canRollBack: false,
              },
            ]
          : [],
      },
    }),
  );
  let server: "up" | "down" = "up";
  await page.route("**/api/health", (r) =>
    server === "down" ? r.abort() : r.fulfill({ json: { status: "ok", version, startedAt: "A" } }),
  );
  await page.route("**/api/updates/apply", (r) => r.fulfill({ status: 202, json: { ok: true } }));
  await page.goto("/settings");
  const about = page.locator("#updates");
  await about.getByRole("button", { name: "Update to 99.0.0" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Update to 99.0.0" }).click();

  const overlay = page.getByRole("dialog", { name: /^Installing/ });
  await expect(overlay).toBeVisible();
  server = "down";
  await page.keyboard.press("Escape");
  await expect(overlay).toBeVisible();
  await page.waitForEvent("requestfailed", (r) => r.url().endsWith("/api/health"));

  // The same version comes back: it went back, the overlay closes and About explains.
  failed = true;
  server = "up";
  await expect(overlay).toHaveCount(0);
  await expect(about.getByRole("alert")).toContainText("Updating to 99.0.0 failed while");
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
