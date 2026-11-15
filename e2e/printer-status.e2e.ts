import { expect, test } from "./fixtures.ts";

// Plan 6.0.0 Step 3: the mock printer prints in a loop (here every 20 s); its card on the
// dashboard and printer page shows it live, and each print it finishes lands in Prints.
test("the mock printer shows live and its print lands when it ends", async ({ page, app }) => {
  test.setTimeout(90_000);
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    config: { liveCycleSec: 20 },
    secrets: { token: "t" },
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });

  await page.goto("/");
  const card = page.getByRole("article", { name: "01-Mock printer" });
  // The server looks for new sources every 10 s.
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("Printing")).toBeVisible({ timeout: 25_000 });
  const progress = card.getByRole("progressbar", { name: "Print progress" });
  await expect(progress).toHaveAttribute("aria-valuetext", /^Layer \d+ of 50$/);
  await expect(card.getByText(/left, done at/)).toBeVisible();
  await expect(card.getByText("Nozzle")).toBeVisible();
  await expect(card.getByRole("list", { name: "Filament" })).toContainText("PLA");

  // A print ends every 20 s: it is recorded once, under its own title.
  await expect
    .poll(
      async () =>
        (await app.api<{ items: { title: string }[] }>("GET", "/api/prints")).items.filter(
          (p) => p.title === "Mock live print",
        ).length,
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);

  // The printer's own page has the same card; keyboard reaches its link from the dashboard.
  await card.getByRole("link", { name: "01-Mock printer" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/printers\/[0-9a-f-]+$/);
  await expect(page.getByRole("article", { name: "01-Mock printer" })).toBeVisible();
});

test("without a live source the dashboard says where to connect one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No printer reports what it is doing yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect one in Integrations" })).toBeVisible();
});
