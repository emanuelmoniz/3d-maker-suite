import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, offScreen, seedModel, seedPrinter, seedSpool } from "./helpers.ts";

// Detail and edit pages that no other sweep visits (clients, quotes, orders, projects: v2; spool: v13).
for (const [name, width, height] of [
  ["mobile", 375, 800],
  ["tablet", 768, 1024],
  ["desktop", 1440, 900],
] as const) {
  test(`detail pages fit the screen at ${name}`, async ({ page, app }) => {
    const printer = await seedPrinter(app.api);
    const spool = await seedSpool(app.api);
    const profile = (await app.api<{ items: { id: string }[] }>("GET", "/api/filament/profiles"))
      .items[0];
    const model = await seedModel(app.api);
    const accessory = await app.api<{ id: string }>("POST", "/api/accessories", {
      name: "AMS",
      type: "AMS",
    });
    const type = await app.api<{ id: string }>("POST", "/api/maintenance/types", {
      name: "Clean nozzle",
      intervalDays: 10,
      warnLeadDays: 10,
    });
    const print = await app.api<{ id: string }>("POST", "/api/prints", {
      title: "Sweep",
      printerId: printer.id,
      startedAt: new Date().toISOString(),
      durationSec: 600,
      outcome: "success",
      usages: [{ spoolId: spool.id, grams: 20 }],
    });
    const alerts = await app.api<{ id: string }[]>("GET", "/api/alerts");

    await page.setViewportSize({ width, height });
    const bad: string[] = [];
    for (const route of [
      `/printers/${printer.id}`,
      `/printers/${printer.id}/edit`,
      `/printers/models/${model.id}/edit`,
      `/printers/accessories/${accessory.id}`,
      `/printers/accessories/${accessory.id}/edit`,
      `/maintenance/types/${type.id}`,
      `/maintenance/types/${type.id}/edit`,
      `/filament/spools/${spool.id}`,
      `/filament/spools/${spool.id}/edit`,
      `/filament/profiles/${profile?.id}`,
      `/filament/profiles/${profile?.id}/edit`,
      `/prints/${print.id}`,
      `/prints/${print.id}/edit`,
      ...(alerts[0] ? [`/alerts/${alerts[0].id}`] : []),
    ]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 }), route).toBeVisible();
      if (await hasHorizontalScroll(page)) bad.push(`${route}: scrolls sideways`);
      for (const p of await offScreen(page)) bad.push(`${route}: ${p}`);
      // A namespace the route did not load shows its keys ("list.columns.name") instead of text.
      const key = (await page.locator("main").innerText()).match(/\b[a-z]+(\.[a-zA-Z]+){2,}\b/);
      if (key) bad.push(`${route}: untranslated "${key[0]}"`);
    }
    expect(bad).toEqual([]);
  });
}
