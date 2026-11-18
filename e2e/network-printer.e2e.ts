import type { Integration } from "@3d-maker-suite/core";
import { expect, test } from "./fixtures.ts";
import { pick, seedPrinter } from "./helpers.ts";

// 6.0.0 Step 17: a printer on the network is one printer, linked when it is saved. A printer
// added by hand is picked on the add form and never comes back twice.
for (const width of [375, 1440])
  test(`a printer added by hand is linked to its network source at setup (${width}px)`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const mine = await seedPrinter(app.api, "Voron 2.4");
    await page.goto("/integrations/new");
    await page.getByRole("radio", { name: "Demo printer on the network (mock)" }).check();
    const printer = page.getByRole("combobox", { name: "Printer" });
    await expect(printer).toHaveValue("New printer from this source");
    // The options: a new printer, then yours with no network source yet.
    await pick(printer, 1);
    await page.getByLabel("Address").fill("voron.lan");
    await page.getByLabel(/^Token/).fill("ana");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Connection works. Found Mock printer (M1), serial MOCK0001.",
    );
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.waitForURL(/\/integrations#integration-/);
    const id = page.url().split("#integration-")[1] ?? "";

    const saved = await app.api<Integration>("GET", `/api/integrations/${id}`);
    expect(saved.printerId).toBe(mine.id);
    const printers = await app.api<{ items: { id: string; name: string }[] }>(
      "GET",
      "/api/printers",
    );
    expect(printers.items).toMatchObject([{ id: mine.id, name: "Voron 2.4" }]);

    // Its Edit page shows the printer it is; it is no longer offered to another source.
    await page.goto(`/integrations/${id}/edit`);
    await expect(page.getByRole("combobox", { name: "Printer" })).not.toHaveValue(
      "New printer from this source",
    );

    // No printers line: it has no printers sync.
    await page.goto("/printers/settings/sources");
    await expect(page.locator(`#source-${id}-printers`)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
