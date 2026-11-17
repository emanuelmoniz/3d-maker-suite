import { expect, test } from "./fixtures.ts";
import { filamentOf, pick, seedFilament } from "./helpers.ts";

// Fixed in 6.0.0-alpha.3: the filament review alert's button to the queue, the queue's spool column
// wide enough for the picked spool, and the Started field's date and time side by side.
const WIDTHS = [
  { name: "phone", width: 375, height: 800 },
  { name: "desktop", width: 1280, height: 900 },
];

for (const { name, width, height } of WIDTHS) {
  test(`filament review alert, queue and Started field at ${name} width`, async ({ page, app }) => {
    await page.setViewportSize({ width, height });
    const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
      adapterId: "mock",
      secrets: { token: "t" },
    });
    await app.api("PATCH", `/api/integrations/${id}`, {
      policies: [{ type: "prints", mode: "auto", frequency: "1h", reviewPolicy: "always" }],
    });
    await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
    await app.api("POST", "/api/filament/spools", {
      ...filamentOf(await seedFilament(app.api)),
      colorHex: "#ff8800",
      initialGrams: 1000,
    });
    await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });

    // The alert's own view: what it is about, and a button to the queue.
    await page.goto("/alerts");
    await page.getByRole("link", { name: /filament slots wait for a spool/ }).click();
    await expect(page.locator("dd", { hasText: /^Filament to review$/ })).toBeVisible();
    await page.getByRole("link", { name: "Review filament" }).click();
    await expect(page).toHaveURL(/\/prints\/review$/);

    // The picked spool's whole name fits in its field.
    const combo = page.getByRole("combobox", { name: /^Spool for / }).first();
    await pick(combo, 1);
    await expect(combo).toHaveValue(/Acme/);
    expect(await combo.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );

    // Started: a usable date field next to the time, which has its own name.
    const [print] = (await app.api<{ items: { id: string }[] }>("GET", "/api/prints")).items;
    await page.goto(`/prints/${print?.id}/edit`);
    const date = page.getByRole("textbox", { name: "Started" });
    const time = page.getByLabel("Time", { exact: true });
    const [d, t] = [await date.boundingBox(), await time.boundingBox()];
    expect(d?.width).toBeGreaterThan(120);
    expect(t?.width).toBeLessThan(d?.width ?? 0);
    expect(Math.abs((d?.y ?? 0) - (t?.y ?? 0))).toBeLessThan(2);
    await expect(page.getByRole("button", { name: "Open calendar" })).toBeInViewport();
  });
}
