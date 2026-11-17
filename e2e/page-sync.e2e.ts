import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";

/** An OrcaSlicer folder with one printer brand and its model. */
function slicerFolder() {
  const dir = mkdtempSync(join(tmpdir(), "page-sync-"));
  mkdirSync(join(dir, "system", "Acme", "machine"), { recursive: true });
  writeFileSync(
    join(dir, "system", "Acme.json"),
    JSON.stringify({ name: "Acme", version: "1", machine_model_list: [{ name: "Acme X" }] }),
  );
  writeFileSync(
    join(dir, "system", "Acme", "machine", "Acme X 0.4 nozzle.json"),
    JSON.stringify({
      name: "Acme X 0.4 nozzle",
      type: "machine",
      instantiation: "true",
      printer_model: "Acme X",
      nozzle_diameter: ["0.4"],
    }),
  );
  return dir;
}

test("Sync buttons show only where a source has the type on Auto, and sync it", async ({
  page,
  app,
}) => {
  // No source yet: no page has a Sync button.
  await page.goto("/catalog/printers");
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sync/ })).toHaveCount(0);
  await page.goto("/printers");
  await expect(page.getByRole("button", { name: /^Sync/ })).toHaveCount(0);

  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "orca-slicer",
  });
  await app.api("PATCH", `/api/integrations/${id}`, { slicerConfigDir: slicerFolder() });

  // The slicer's catalog types follow Auto: every table and the page have a button.
  await page.goto("/catalog/printers");
  await expect(page.getByRole("button", { name: "Sync all" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync Printer brands" })).toBeVisible();
  // It reads no printers, prints or spools: those pages stay without one.
  await page.goto("/printers");
  await expect(page.getByRole("heading", { name: "Printers", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sync/ })).toHaveCount(0);

  await page.goto("/catalog/printers");
  await page.getByRole("button", { name: "Sync all" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Acme", exact: true }).first()).toBeVisible();

  // Manual: the source is left out, so the buttons go.
  await app.api("PATCH", `/api/integrations/${id}`, {
    policies: [
      "brands",
      "printerModels",
      "machinePresets",
      "processPresets",
      "filamentBrands",
      "filamentMaterials",
      "filamentPresets",
    ].map((type) => ({ type, mode: "manual" })),
  });
  await page.goto("/catalog/printers");
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sync/ })).toHaveCount(0);
});
