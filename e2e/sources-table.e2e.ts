import { expect, test } from "./fixtures.ts";

// 6.1.0 Step 18: Printers, Prints and Filament → Sources are one table with a row per source.
for (const width of [375, 1440])
  test(`every source is a row of one table, sorted by name (${width}px)`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 900 });
    const ids: Record<string, string> = {};
    for (const token of ["zed", "ana"]) {
      const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
        adapterId: "mock",
        secrets: { token },
      });
      ids[token] = id;
      // A sync reads the account's profile.
      await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
    }
    // Saved without a sign-in: signed out.
    await app.api("POST", "/api/integrations", { adapterId: "mock-login" });

    await page.goto("/printers/settings/sources");
    const table = page.getByRole("table", { name: "Sources of Printers" });
    const rows = table.getByRole("row");
    await expect(rows).toHaveCount(4);
    await expect(page.getByRole("table")).toHaveCount(1);
    await expect(rows.nth(1)).toContainText("Demo account with sign-in (mock)");
    await expect(rows.nth(1).getByRole("link", { name: /^Signed out/ })).toBeVisible();
    await expect(rows.nth(2)).toContainText("ana@example.com");
    await expect(rows.nth(3)).toContainText("zed@example.com");

    // The source type leads back to the source on Integrations.
    await expect(
      rows.nth(2).getByRole("link", { name: /^Open Demo data \(mock\).* in Integrations$/ }),
    ).toHaveAttribute("href", `/settings/integrations#integration-${ids.ana}`);

    // A row's switch pauses that source alone.
    const zed = rows.nth(3);
    await zed.getByRole("switch", { name: /^Sync Printers from / }).click({ force: true });
    await expect(zed.getByText("Paused", { exact: true })).toBeVisible();
    await expect(rows.nth(2).getByText("Paused", { exact: true })).toHaveCount(0);
    // It stays disabled until the page has refreshed after the change.
    await expect(zed.getByRole("switch", { name: /^Sync Printers from / })).toBeEnabled();
    await zed.getByRole("switch", { name: /^Sync Printers from / }).click({ force: true });
    await expect(zed.getByText("Paused", { exact: true })).toHaveCount(0);

    // Its Edit and `⋯` act on that source.
    const ana = rows.nth(2);
    await ana.getByRole("button", { name: /^Edit Printers from / }).click();
    const dialog = page.getByRole("dialog", { name: "Printers from ana@example.com" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await ana.getByLabel(/^More for Printers from /).click();
    const synced = page.waitForResponse((r) =>
      r.url().endsWith(`/api/integrations/${ids.ana}/sync`),
    );
    await page.getByRole("button", { name: "Sync now" }).click();
    expect((await synced).status()).toBe(200);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });

test("an account shows its name before its email, with no card around the table", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    config: { label: "Ana" },
    secrets: { token: "ana" },
  });
  // A sync reads the account's profile.
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await page.goto("/printers/settings/sources");
  const row = page.getByRole("table", { name: "Sources of Printers" }).getByRole("row").nth(1);
  await expect(row.getByText("Ana", { exact: true })).toBeVisible();
  await expect(row).not.toContainText("ana@example.com");
  await expect(page.getByRole("heading", { name: "Share to server" })).toHaveCount(0);
});

test("a link to a source brings its row into view on a phone", async ({ page, app }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  let last = "";
  for (const token of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
      adapterId: "mock",
      config: { label: token },
      secrets: { token },
    });
    last = id;
  }
  await page.goto(`/printers/settings/sources#source-${last}-printers`);
  await expect(page.locator(`#source-${last}-printers`)).toBeInViewport();
});
