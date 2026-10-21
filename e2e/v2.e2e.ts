import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, offScreen, seedPrinter, seedProject } from "./helpers.ts";

const VIEWPORTS = [
  ["mobile", 375, 800],
  ["tablet", 768, 1024],
  ["desktop", 1440, 900],
] as const;

// v2 pages (clients, quotes, orders, project files and description) with real rows on them.
for (const [name, width, height] of VIEWPORTS) {
  test(`v2 pages fit the screen at ${name}`, async ({ page, app }) => {
    const printer = await seedPrinter(app.api);
    const project = await seedProject(app.api, "A project with quite a long name to wrap");
    const client = await app.api<{ id: string }>("POST", "/api/clients", {
      name: "Ana Maria da Silva Pereira",
      mobile: "911222333",
    });
    const quote = await app.api<{ id: string }>("POST", "/api/costs/quotes", {
      name: "Lamp",
      projectId: project.id,
      clientId: client.id,
      form: { minutes: 60, filaments: [], quantity: 1 },
      cost: { material: 0, energy: 0, wear: 0, maintenance: 0, total: 0, unpricedGrams: 0 },
      quote: {
        unitCost: 0,
        labor: 0,
        failureMargin: 0,
        subtotal: 0,
        markup: 0,
        unitPrice: 12345,
        quantity: 1,
        total: 12345,
      },
    });
    const order = await app.api<{ id: string }>("POST", "/api/orders", {
      projectIds: [project.id],
      quoteId: quote.id,
      clientId: client.id,
      price: 12345,
    });
    await app.api("POST", "/api/prints", {
      title: "Sweep",
      printerId: printer.id,
      projectId: project.id,
      startedAt: new Date().toISOString(),
      durationSec: 600,
      outcome: "success",
    });

    await page.setViewportSize({ width, height });
    const bad: string[] = [];
    for (const route of [
      "/clients",
      "/clients/new",
      `/clients/${client.id}`,
      `/clients/${client.id}/edit`,
      "/quotes",
      `/quotes/${quote.id}`,
      "/orders",
      "/orders/new",
      `/orders/${order.id}`,
      `/orders/${order.id}/edit`,
      "/projects/new",
      `/projects/${project.id}`,
      `/projects/${project.id}/edit`,
      "/costs/settings",
    ]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 }), route).toBeVisible();
      if (await hasHorizontalScroll(page)) bad.push(`${route}: scrolls sideways`);
      for (const p of await offScreen(page)) bad.push(`${route}: ${p}`);
    }
    expect(bad).toEqual([]);
  });
}

test("project files: row buttons are 40px tap targets on a phone", async ({ page, app }) => {
  const root = join(app.dataDir, "root");
  mkdirSync(root, { recursive: true });
  await app.api("PATCH", "/api/preferences", { projectRoots: [root] });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/projects/new");
  await page.getByLabel("Name", { exact: true }).fill("Vase");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Vase" })).toBeVisible();
  const files = page.getByRole("region", { name: "Files" });
  await files
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(files.getByText("a.txt")).toBeVisible();
  for (const name of ["Replace a.txt", "Rename a.txt", "Move a.txt", "Delete a.txt"]) {
    const b = await files.getByRole("button", { name }).boundingBox();
    expect(b?.width, name).toBeGreaterThanOrEqual(40);
    expect(b?.height, name).toBeGreaterThanOrEqual(40);
  }
});
