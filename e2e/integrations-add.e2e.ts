import { expect, test } from "./fixtures.ts";

for (const width of [375, 1440])
  test(`add a slicer to this server, once (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // Installed here if this computer has it, else downloaded (Plan 5.5.0 Step 9).
    const adapters: { id: string; detectedConfigDir: string | null }[] = await (
      await page.request.get("/api/integrations/adapters")
    ).json();
    const found = !!adapters.find((a) => a.id === "bambu-studio")?.detectedConfigDir;
    await page.goto("/integrations/new");
    await page.getByRole("radio", { name: "Bambu Studio" }).check();
    // No choice of where: a workstation's slicer is set up on its machine page.
    await expect(page.getByRole("radio", { name: /workstation/ })).toHaveCount(0);
    await expect(
      page.getByText(found ? "Uses the Bambu Studio installed" : "Bambu Studio isn't installed"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // One card for the slicer, with this server's install open.
    await expect(page).toHaveURL(/\/integrations#integration-/);
    const card = page.getByRole("region", { name: "Bambu Studio" });
    const where = found ? "This computer" : "This server";
    await expect(card.getByRole("heading", { name: where, level: 3 })).toBeVisible();
    await expect(
      found
        ? card.getByRole("textbox", { name: "Config folder" })
        : card.getByRole("button", { name: "Install slicer" }),
    ).toBeVisible();
    // Nothing more to add here: a second install is refused, from the form and the API.
    await expect(card.getByRole("link", { name: "Add to this server" })).toHaveCount(0);
    await page.goto("/integrations/new?product=bambu-studio");
    await expect(page.getByText("Already on this server")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    const other = found ? "bambu-studio-server" : "bambu-studio";
    const res = await page.request.post("/api/integrations", { data: { adapterId: other } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("slicer_exists");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );

    // Its catalog cards are on Presets settings → Sources.
    await page.goto("/integrations");
    await card.getByRole("link", { name: /^Catalog: / }).click();
    await expect(page).toHaveURL(/\/presets\/settings\/sources#library-bambu-studio$/);
    const sources = page.getByRole("region", { name: "Where your presets come from" });
    await expect(sources.getByRole("heading", { name: where, level: 4 })).toBeVisible();
  });
