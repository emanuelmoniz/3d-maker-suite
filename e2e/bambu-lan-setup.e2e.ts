import { expect, test } from "./fixtures.ts";

for (const width of [375, 1440])
  test(`Bambu LAN setup asks for the IP or the serial (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let posted = false;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/integrations")) posted = true;
    });
    await page.goto("/integrations/new");
    await page.getByRole("radio", { name: "Bambu Lab printer (LAN)" }).check();
    await page.getByLabel(/^Access code/).fill("12345678");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const ip = page.getByLabel(/^Printer IP/);
    await expect(page.getByText("Enter the printer's IP or its serial number.")).toBeVisible();
    await expect(ip).toHaveAttribute("aria-invalid", "true");
    expect(posted).toBe(false);
    // Typing clears it.
    await ip.fill("192.0.2.10");
    await expect(page.getByText("Enter the printer's IP or its serial number.")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
