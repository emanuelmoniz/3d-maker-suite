import { expect, test } from "./fixtures.ts";

// ADR-0021: one block per account, told apart by who it is, each with its Enabled switch; the
// Sources tabs its types are set up on are buttons for the whole card.
for (const width of [375, 1440])
  test(`two accounts show apart, each switched on and off on its own (${width}px)`, async ({
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

    const sources = card.getByRole("region", { name: "Sync sources configurations" });
    for (const name of ["Printers", "Prints", "Filament"])
      await expect(sources.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(sources.getByRole("link", { name: "Filament", exact: true })).toHaveAttribute(
      "href",
      "/filament/settings/sources",
    );

    const enabled = ana.getByRole("switch", { name: "Enabled: ana@example.com" });
    await expect(enabled).toBeChecked();
    await enabled.click({ force: true });
    await expect(enabled).not.toBeChecked();
    await expect(ana.getByText("Switched off: nothing is synced from this account.")).toBeVisible();
    await expect(
      card
        .getByRole("listitem")
        .filter({ hasText: "workshop@example.com" })
        .getByRole("switch", { name: "Enabled: workshop@example.com" }),
    ).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
