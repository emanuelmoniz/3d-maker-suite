import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { gotoIntegrations } from "./helpers.ts";

type Policy = { type: string; scope: string };

/** An OrcaSlicer folder with two printer brands, one model each. */
function slicerFolder() {
  const dir = mkdtempSync(join(tmpdir(), "catalog-row-"));
  for (const [vendor, model] of [
    ["Acme", "Acme X"],
    ["Zeta", "Zeta Z"],
  ] as const) {
    mkdirSync(join(dir, "system", vendor, "machine"), { recursive: true });
    writeFileSync(
      join(dir, "system", `${vendor}.json`),
      JSON.stringify({ name: vendor, version: "1", machine_model_list: [{ name: model }] }),
    );
    writeFileSync(
      join(dir, "system", vendor, "machine", `${model} 0.4 nozzle.json`),
      JSON.stringify({
        name: `${model} 0.4 nozzle`,
        type: "machine",
        instantiation: "true",
        printer_model: model,
        nozzle_diameter: ["0.4"],
      }),
    );
  }
  return dir;
}

test("catalog row: pick brands, only those arrive, then only what you have", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "orca-slicer",
  });
  await app.api("PATCH", `/api/integrations/${id}`, { slicerConfigDir: slicerFolder() });
  await gotoIntegrations(page);

  // One row for the seven catalog types, and Bambu Cloud's rows (not here) keep theirs.
  await expect(page.getByRole("button", { name: "Settings: Brands" })).toHaveCount(0);
  await expect(page.getByText("Everything", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Choose brands" }).click();
  const printerBrands = page.getByRole("group", { name: "Printer brands" });
  await expect(printerBrands.getByRole("checkbox", { name: "Zeta" })).not.toBeChecked();
  await printerBrands.getByRole("checkbox", { name: "Acme" }).check();
  await page.getByRole("button", { name: "Import 1 brand" }).click();

  await expect(page.getByRole("button", { name: "Import 1 brand" })).toBeHidden();
  const names = async (path: string) =>
    (await app.api<{ items: { name: string }[] }>("GET", path)).items.map((r) => r.name);
  expect(await names("/api/brands")).toEqual(["Acme"]);
  expect(await names("/api/machine-profiles")).toEqual(["Acme X 0.4 nozzle"]);
  const { policies } = await app.api<{ policies: Policy[] }>("GET", `/api/integrations/${id}`);
  const catalog = policies.filter((p) => p.type !== "openInSlicer" && p.type !== "slice");
  expect(catalog.length).toBeGreaterThanOrEqual(7);
  expect(catalog.filter((p) => p.scope === "imported").length).toBeGreaterThanOrEqual(7);
  await expect(page.getByRole("switch", { name: "Only what I already have" })).toBeChecked();

  // The brand you picked is checked and locked when you choose again.
  await page.getByRole("button", { name: "Choose brands" }).click();
  await expect(
    page.getByRole("group", { name: "Printer brands" }).getByRole("checkbox", { name: /Acme/ }),
  ).toBeDisabled();

  // Back to everything.
  // Controlled by the saved policies, so the state follows the request, not the click.
  await page.getByRole("switch", { name: "Only what I already have" }).click({ force: true });
  await expect(page.getByRole("switch", { name: "Only what I already have" })).not.toBeChecked();
  await expect(page.getByText("Every brand, model and profile")).toBeVisible();
});
