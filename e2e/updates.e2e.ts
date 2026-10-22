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
  await expect(page.getByRole("complementary").getByText(`Version ${version}`)).toBeVisible();
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
