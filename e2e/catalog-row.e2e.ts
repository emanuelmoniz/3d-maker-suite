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
  // Actions say what they do; they stay with the connection.
  await gotoIntegrations(page);
  await expect(page.getByText("When active, this integration can be used")).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose brands" })).toHaveCount(0);

  // The summary line leads to the slicer's lines on Catalog settings → Sources.
  await page.getByRole("link", { name: /^Catalog: / }).click();
  await expect(page).toHaveURL(/\/catalog\/settings\/sources#server-orca-slicer$/);
  const lines = page.getByRole("table", { name: "What OrcaSlicer syncs" });
  for (const name of ["Printer brands", "Printer models", "Filament brands", "Filament materials"])
    await expect(lines.getByText(name, { exact: true })).toBeVisible();

  // Its presets are on Presets settings; no schedule, because a change in the files runs them.
  await page.goto("/presets/settings/sources");
  const presets = page.getByRole("table", { name: "What OrcaSlicer syncs" });
  for (const kind of ["printer", "process", "filament"])
    for (const name of [`System ${kind} presets`, `User ${kind} presets`])
      await expect(presets.getByText(name, { exact: true })).toBeVisible();
  const whenOf = async (name: string) => {
    await page.getByRole("button", { name: `Edit ${name} from OrcaSlicer` }).click();
    const dialog = page.getByRole("dialog", { name: `${name} from OrcaSlicer` });
    await expect(dialog.getByRole("combobox", { name: `Frequency: ${name}` })).toHaveCount(0);
    const when = dialog.getByRole("switch", { name: `Automatic when the files change: ${name}` });
    const on = await when.isChecked();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    return on;
  };
  expect(await whenOf("System printer presets")).toBe(false);
  expect(await whenOf("User printer presets")).toBe(true);
  await page.goto("/catalog/settings/sources");

  // Nothing yet in your catalog; select all takes both of a list, and you can take one back.
  await expect(page.getByText(/Printer brands in your catalog/)).toHaveCount(0);
  await page.getByRole("button", { name: "Choose brands" }).click();
  const printerBrands = page.getByRole("group", { name: "Printer brands" });
  const all = printerBrands.getByRole("checkbox", { name: "Select all" });
  await all.check();
  await expect(printerBrands.getByRole("checkbox", { name: "Zeta" })).toBeChecked();
  await printerBrands.getByRole("checkbox", { name: "Zeta" }).uncheck();
  await expect(all).not.toBeChecked();
  await page.getByRole("button", { name: "Import 1 brand" }).click();

  await expect(page.getByRole("button", { name: "Import 1 brand" })).toBeHidden();
  const names = async (path: string) =>
    (await app.api<{ items: { name: string }[] }>("GET", path)).items.map((r) => r.name);
  expect(await names("/api/brands")).toEqual(["Acme"]);
  expect(await names("/api/machine-presets")).toEqual(["Acme X 0.4 nozzle"]);
  const { policies } = await app.api<{ policies: Policy[] }>("GET", `/api/integrations/${id}`);
  const catalog = policies.filter((p) => p.type !== "openInSlicer" && p.type !== "slice");
  expect(catalog.length).toBeGreaterThanOrEqual(7);
  // A pick keeps the catalog and system cards to what you have; the user preset cards don't change.
  const scopeOf = (type: string) => catalog.find((p) => p.type === type)?.scope;
  expect(scopeOf("machinePresets")).toBe("imported");
  expect(scopeOf("brands")).toBe("imported");
  expect(scopeOf("userMachinePresets")).toBe("all");

  // What you have shows on the closed card, and is checked and locked when you choose again.
  await expect(page.getByText("Printer brands in your catalog: Acme")).toBeVisible();
  await page.getByRole("button", { name: "Choose brands" }).click();
  const again = page.getByRole("group", { name: "Printer brands" });
  await expect(again.getByText("In your catalog", { exact: true })).toBeVisible();
  await expect(again.getByRole("checkbox", { name: "Acme" })).toBeDisabled();
  await expect(again.getByRole("checkbox", { name: "Acme" })).toBeChecked();
});
