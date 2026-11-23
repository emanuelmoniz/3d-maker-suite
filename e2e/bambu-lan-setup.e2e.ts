import { expect, test } from "./fixtures.ts";

const NOT_HEARD = /The printer's announcement wasn't heard/;

// Plan 6.3.0 Step 6: a serial alone is found by the printer's announce, which a container on a bridge
// network or another subnet never hears. The text asks for the IP, and only then.
test("Bambu LAN with a serial alone and no announce asks for the IP", async ({ page }) => {
  let host: string | undefined;
  await page.route("**/api/integrations/test", (route) => {
    host = route.request().postDataJSON().config.host;
    return route.fulfill({ json: { ok: false, code: "unreachable" } });
  });
  await page.goto("/integrations/new");
  await page.getByRole("radio", { name: "Bambu Lab printer (LAN)" }).check();
  await page.getByLabel(/^Serial number/).fill("01P00A000000000");
  await page.getByLabel(/^Access code/).fill("12345678");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText(NOT_HEARD)).toBeVisible();
  expect(host).toBeUndefined();

  // With an address, the printer really can't be reached: the general text stays.
  await page.getByLabel(/^Printer IP/).fill("192.0.2.10");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText("The vendor service can't be reached.")).toBeVisible();
  await expect(page.getByText(NOT_HEARD)).toHaveCount(0);
});

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
