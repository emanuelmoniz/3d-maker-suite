import { expect, test } from "../e2e/fixtures.ts";
import { seedPrinter, seedProfile, seedProject } from "../e2e/helpers.ts";

const IMAGES = "docs/images";

test("README screenshots", async ({ page, app }) => {
  const printer = await seedPrinter(app.api, "Workshop X1");
  await seedPrinter(app.api, "Desk Mini");
  const ams = await app.api<{ id: string }>("POST", "/api/accessories", {
    name: "AMS",
    type: "AMS",
  });
  await app.api("POST", `/api/accessories/${ams.id}/installs`, {
    printerId: printer.id,
    installedAt: new Date().toISOString(),
  });
  await app.api("POST", "/api/accessories", { name: "Spare hotend 0.6", type: "Hotend" });
  const profile = await seedProfile(app.api);
  const spools = [];
  for (const [colorHex, colorName] of [
    ["#e53935", "Red"],
    ["#1e88e5", "Blue"],
    ["#43a047", "Green"],
  ]) {
    spools.push(
      await app.api<{ id: string }>("POST", "/api/filament/spools", {
        profileId: profile.id,
        colorHex,
        colorName,
        initialGrams: 1000,
        pricePaid: 20,
      }),
    );
  }
  const projects = [
    await seedProject(app.api, "Dragon"),
    await seedProject(app.api, "Desk organizer"),
    await seedProject(app.api, "Planter"),
  ];
  const day = 86_400_000;
  for (let i = 0; i < 18; i++) {
    await app.api("POST", "/api/prints", {
      printerId: printer.id,
      projectId: projects[i % 3]?.id,
      title: `${["Dragon body", "Organizer tray", "Planter pot"][i % 3]} #${i + 1}`,
      startedAt: new Date(Date.now() - (18 - i) * day).toISOString(),
      durationSec: 3600 * (1 + (i % 5)),
      outcome: i % 7 === 6 ? "failed" : "success",
      usages: [{ spoolId: spools[i % 3]?.id, grams: 20 + ((i * 13) % 80) }],
    });
  }

  const shots: [string, string, string?][] = [
    ["dashboard", "/"],
    ["printers", "/printers"],
    ["project", "/projects", "Dragon"],
    ["prints", "/prints"],
    ["filament", "/filament"],
    ["stats", "/stats"],
    ["quotes", "/quotes/new"],
  ];
  for (const [name, path, open] of shots) {
    await page.goto(path);
    if (open) await page.getByRole("link", { name: open }).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
    await page.screenshot({ path: `${IMAGES}/${name}.png` });
  }
});
