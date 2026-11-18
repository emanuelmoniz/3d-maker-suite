import type { Integration } from "@3d-maker-suite/core";
import { expect, test } from "./fixtures.ts";
import { seedPrinter } from "./helpers.ts";

// 6.1.0 Step 19: every printer on the network is a row of Prints → Sources, with Record prints.
for (const width of [375, 1440])
  test(`a network printer's prints are switched on its row (${width}px)`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 900 });
    const add = async (adapterId: string, name: string) => {
      const mine = await seedPrinter(app.api, name);
      return app.api<Integration>("POST", "/api/integrations", {
        adapterId,
        config: { host: `${adapterId}.lan` },
        secrets: { token: "t" },
        printer: mine.id,
      });
    };
    const live = await add("mock-live", "Prusa");
    await add("mock-host", "Voron");

    await page.goto("/prints/settings/sources");
    const rows = page.getByRole("table", { name: "Sources of Print history" }).getByRole("row");
    await expect(rows).toHaveCount(3);
    const liveRow = rows.nth(1);
    const historyRow = rows.nth(2);

    // Live only: how its prints arrive, no schedule and nothing to run. With a history: a schedule.
    await expect(liveRow).toContainText("Demo live-only printer (mock)");
    await expect(liveRow).toContainText("Recorded live as each print ends");
    await expect(liveRow.getByLabel(/^More for /)).toHaveCount(0);
    await expect(historyRow).toContainText("Demo printer on the network (mock)");
    await expect(historyRow).not.toContainText("Recorded live as each print ends");
    await expect(historyRow.getByLabel(/^More for /)).toBeVisible();
    // Edit lines up, with or without a `⋯` after it.
    const editEnd = async (row: typeof liveRow) => {
      const box = await row.getByRole("button", { name: /^Edit / }).boundingBox();
      return (box?.x ?? 0) + (box?.width ?? 0);
    };
    expect(await editEnd(liveRow)).toBeCloseTo(await editEnd(historyRow), 0);

    // Its settings are what happens to a print: no schedule to edit.
    await liveRow.getByRole("button", { name: /^Edit / }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Track usage")).toBeVisible();
    await expect(dialog.getByRole("switch", { name: /^Auto/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Off for one printer: the other goes on recording, and it stays off after a reload.
    await liveRow.getByRole("switch", { name: /^Record prints from / }).click({ force: true });
    await expect(liveRow).toContainText("Not recorded. Live status goes on.");
    await expect(liveRow.getByText("Paused", { exact: true })).toBeVisible();
    await expect(historyRow.getByText("Paused", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(liveRow).toContainText("Not recorded. Live status goes on.");
    const saved = await app.api<Integration>("GET", `/api/integrations/${live.id}`);
    expect(saved.policies.find((p) => p.type === "printerStatus")).toMatchObject({
      recordPrints: false,
      mode: "manual",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );

    // The printer's block on its card opens its row.
    await page.goto(`/settings/integrations#integration-${live.id}`);
    await page
      .locator(`#integration-${live.id}`)
      .getByRole("link", { name: /^Prints sources: / })
      .click();
    await expect(page).toHaveURL(new RegExp(`/prints/settings/sources#source-${live.id}-prints$`));
    await expect(page.locator(`#source-${live.id}-prints`)).toBeInViewport();
  });
