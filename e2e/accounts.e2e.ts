import { expect, test } from "./fixtures.ts";

// ADR-0021: one block per account, told apart by who it is; Allow switches with their links.
for (const width of [375, 1440])
  test(`two accounts show apart, and an Allow switch asks before it stops (${width}px)`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const token of ["ana", "workshop"]) {
      const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
        adapterId: "mock",
        secrets: { token },
      });
      // A sync reads the account's profile.
      await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
    }
    await page.goto("/integrations");
    const card = page.getByRole("region", { name: "Demo data (mock)" });
    const ana = card.getByRole("listitem").filter({ hasText: "ana@example.com" });
    await expect(ana.getByRole("heading", { name: "ana@example.com", level: 3 })).toBeVisible();
    await expect(
      card.getByRole("heading", { name: "workshop@example.com", level: 3 }),
    ).toBeVisible();

    const spools = ana.getByRole("switch", { name: "Spools" });
    await expect(spools).toBeChecked();
    await expect(ana.getByRole("link", { name: "Filament settings" })).toBeVisible();
    await spools.click({ force: true });
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: "Stop syncing spools from this account?" });
    await expect(dialog.getByText("The spools already imported stay.")).toBeVisible();
    await dialog.getByRole("button", { name: "Stop syncing" }).click();
    await expect(spools).not.toBeChecked();
    await expect(ana.getByRole("link", { name: "Filament settings" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
