import type { Integration } from "@3d-maker-suite/core";
import { expect, test } from "./fixtures.ts";

// 6.0.0 Step 16: Test what the add form holds before saving, then change it on its Edit page; a
// key left empty there is the stored one.
for (const width of [375, 1440])
  test(`an integration is tested before saving and edited (${width}px)`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 900 });
    const label = `Shop ${width}`;
    let posted = false;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/integrations")) posted = true;
    });
    await page.goto("/integrations/new");
    await page.getByRole("radio", { name: "Demo data (mock)" }).check();
    await page.getByLabel("Label").fill(label);
    const token = page.getByLabel(/^Token/);
    await token.fill("wrong");
    const testButton = page.getByRole("button", { name: "Test", exact: true });
    await testButton.click();
    await expect(page.getByRole("status")).toHaveText("Sign-in required. Check the credentials.");
    expect(posted).toBe(false);

    // A changed field: what was said goes.
    await token.fill("ana");
    await expect(page.getByRole("status")).toHaveCount(0);
    await testButton.click();
    await expect(page.getByRole("status")).toHaveText(
      "Connection works. Found Mock printer (M1), serial MOCK0001.",
    );
    expect(posted).toBe(false);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.waitForURL(/\/integrations#integration-/);
    const id = page.url().split("#integration-")[1];

    const block = page.locator(`#integration-${id}`);
    await block.locator("summary").click();
    await block.getByRole("button", { name: "Edit", exact: true }).click();
    await page.waitForURL(`**/integrations/${id}/edit`);
    await expect(page.getByLabel("Label")).toHaveValue(label);
    await expect(page.getByLabel(/^Token/)).toHaveValue("");
    await expect(page.getByText("Saved. Leave empty to keep it.")).toBeVisible();
    // The stored token is tested: it never comes to the page.
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Connection works. Found Mock printer (M1), serial MOCK0001.",
    );

    await page.getByLabel("Label").fill(`${label} edited`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/integrations#integration-/);
    const saved = await app.api<Integration>("GET", `/api/integrations/${id}`);
    expect(saved.config).toMatchObject({ label: `${label} edited` });
    expect(saved.storedKeys).toEqual(["token"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await app.api("DELETE", `/api/integrations/${id}`);
  });
