import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./fixtures.ts";
import { editLine, filamentOf, pick, seedFilament } from "./helpers.ts";

// Plan 6.0.0 Step 6b: the review level in Prints settings, on a source line and on the printer,
// and the queue's suggestions and estimated grams, at phone and desktop width.
const WIDTHS = [
  { name: "phone", width: 375, height: 800 },
  { name: "desktop", width: 1280, height: 900 },
];

for (const { name, width, height } of WIDTHS) {
  test(`review level and queue at ${name} width`, async ({ page, app }) => {
    await page.setViewportSize({ width, height });
    const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
      adapterId: "mock",
      secrets: { token: "t" },
    });
    await app.api("PATCH", `/api/integrations/${id}`, {
      policies: [{ type: "prints", mode: "auto", frequency: "1h" }],
    });
    await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
    // The one orange PLA spool the mock's prints fit: a sure match.
    const spool = await app.api<{ id: string }>("POST", "/api/filament/spools", {
      ...filamentOf(await seedFilament(app.api)),
      colorHex: "#ff8800",
      initialGrams: 1000,
    });
    const level = (key: "never" | "unmatched" | "always") =>
      ({ never: "Never", unmatched: "When unsure", always: "Always" })[key];

    // Global level: Always.
    await page.goto("/prints/settings");
    await pick(page.getByRole("combobox", { name: "Review of automatic prints" }), level("always"));
    await expect
      .poll(
        async () =>
          (await app.api<{ values: { printReview: string } }>("GET", "/api/preferences")).values
            .printReview,
      )
      .toBe("always");

    // The source line says where its level comes from, and sets its own.
    const dialog = await editLine(page, "prints", "Print history");
    await expect(
      dialog.getByText(/In effect: Always \(the default in Prints settings\)/),
    ).toBeVisible();
    await pick(
      dialog.getByRole("combobox", { name: "Review of automatic prints" }),
      level("unmatched"),
    );
    await expect(dialog.getByText(/In effect: When unsure \(set here\)/)).toBeVisible();
    await pick(
      dialog.getByRole("combobox", { name: "Review of automatic prints" }),
      "Use the default",
    );
    await expect(dialog.getByText(/In effect: Always \(the default/)).toBeVisible();
    await page.keyboard.press("Escape");

    // The printer's level beats the global one: Never charges the sure spool without a review.
    const [printer] = (await app.api<{ items: { id: string }[] }>("GET", "/api/printers")).items;
    await page.goto(`/printers/${printer?.id}/edit`);
    const field = page.getByRole("combobox", { name: "Review of automatic prints" });
    await expect(page.getByText(/In effect: Always/)).toBeVisible();
    await pick(field, level("never"));
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect
      .poll(
        async () =>
          (await app.api<{ reviewPolicy: string | null }>("GET", `/api/printers/${printer?.id}`))
            .reviewPolicy,
      )
      .toBe("never");
    await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });
    const queue = () =>
      app.api<{ total: number }>("GET", "/api/prints/filament-review").then((q) => q.total);
    expect(await queue()).toBe(0);
    const charged = await app.api<{ remainingGrams: number }>(
      "GET",
      `/api/filament/spools/${spool.id}`,
    );
    expect(charged.remainingGrams).toBeLessThan(1000);
  });

  test(`a suggestion is accepted and estimated grams corrected at ${name} width`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height });
    const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
      adapterId: "mock",
      secrets: { token: "t" },
    });
    await app.api("PATCH", `/api/integrations/${id}`, {
      policies: [{ type: "prints", mode: "auto", frequency: "1h", reviewPolicy: "always" }],
    });
    await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
    const spool = await app.api<{ id: string }>("POST", "/api/filament/spools", {
      ...filamentOf(await seedFilament(app.api)),
      colorHex: "#ff8800",
      initialGrams: 1000,
    });
    await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });
    const items = (
      await app.api<{
        items: { usageId: string; suggestedSpoolId: string | null; grams: number }[];
      }>("GET", "/api/prints/filament-review")
    ).items;
    expect(items.length).toBe(3);
    expect(items.every((i) => i.suggestedSpoolId === spool.id)).toBe(true);
    // Nothing is charged until a person accepts.
    expect(
      (await app.api<{ remainingGrams: number }>("GET", `/api/filament/spools/${spool.id}`))
        .remainingGrams,
    ).toBe(1000);

    // One slot's grams are an estimate (no API makes one).
    const [estimated, ...rest] = items;
    const db = new DatabaseSync(join(app.dataDir, "app.sqlite"), { timeout: 5000 });
    try {
      db.prepare("update print_filament_usages set grams_estimated = 1 where id = ?").run(
        estimated?.usageId ?? "",
      );
    } finally {
      db.close();
    }

    await page.goto("/prints/review");
    const rows = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: "Accept", exact: true }) });
    await expect(rows).toHaveCount(3);
    // The estimated one is an input; correct it, then accept.
    const grams = page.getByRole("spinbutton", { name: /^Grams for / });
    await expect(grams).toHaveCount(1);
    await grams.fill("4.5");
    await grams
      .locator("xpath=ancestor::tr")
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    await expect(rows).toHaveCount(2);
    expect(
      (await app.api<{ remainingGrams: number }>("GET", `/api/filament/spools/${spool.id}`))
        .remainingGrams,
    ).toBe(995.5);

    // "Accept suggestions" on the rest.
    await page.getByRole("checkbox", { name: /select all/i }).click();
    await page.getByRole("button", { name: "Accept suggestions" }).click();
    await expect(page.getByText("Nothing to review")).toBeVisible();
    expect(rest.length).toBe(2);
  });
}
