import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, roots, seedPrinter } from "./helpers.ts";

const VIEWPORTS = [
  { width: 375, height: 800 },
  { width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test(`project detail: no folder hides the Files card at ${viewport.width}px`, async ({
    page,
    app,
  }) => {
    const p = await app.api<{ id: string }>("POST", "/api/projects", { name: "No Folder" });
    await page.setViewportSize(viewport);
    await page.goto(`/projects/${p.id}`);
    await expect(page.getByRole("heading", { name: "No Folder" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Files" })).toHaveCount(0);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test(`project detail: no prints hides the Prints card at ${viewport.width}px`, async ({
    page,
    app,
  }) => {
    const root = join(app.dataDir, "models");
    mkdirSync(root, { recursive: true });
    await app.api("PATCH", "/api/preferences", { projectRoots: roots(root) });
    const p = await app.api<{ id: string }>("POST", "/api/projects", {
      name: "No Prints",
      createFolder: true,
    });
    await page.setViewportSize(viewport);
    await page.goto(`/projects/${p.id}`);
    await expect(page.getByRole("region", { name: "Prints" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Files" })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test(`project detail: no 3D file drops the preview and moves the printed cost card to the left at ${viewport.width}px`, async ({
    page,
    app,
  }) => {
    const root = join(app.dataDir, "models");
    mkdirSync(root, { recursive: true });
    await app.api("PATCH", "/api/preferences", { projectRoots: roots(root) });
    const p = await app.api<{ id: string }>("POST", "/api/projects", {
      name: "No Model",
      createFolder: true,
    });
    const printer = await seedPrinter(app.api);
    await app.api("POST", "/api/prints", {
      printerId: printer.id,
      projectId: p.id,
      startedAt: new Date().toISOString(),
      usages: [],
      title: "Calibration",
      outcome: "success",
    });

    await page.setViewportSize(viewport);
    await page.goto(`/projects/${p.id}`);
    const cost = page.getByRole("heading", { name: "Cost of printed copies" });
    await expect(cost).toBeVisible();
    await expect(page.getByRole("img", { name: "No Model", exact: true })).toHaveCount(0);
    if (viewport.width >= 1024) {
      const box = await cost.boundingBox();
      const half = viewport.width / 2;
      expect(box?.x ?? half).toBeLessThan(half);
    }
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
}
