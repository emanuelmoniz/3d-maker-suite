import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { insertPreset } from "./helpers.ts";

/** A filament preset row from a slicer file (it needs a material). */
const filament = async (
  app: { api: <T>(m: string, p: string, b?: unknown) => Promise<T>; dataDir: string },
  name: string,
  sourcePreset: string,
) => {
  const { id: materialId } = await app.api<{ id: string }>("POST", "/api/filament-materials", {
    name: `PLA ${name}`,
  });
  return insertPreset(app, "filament_presets", { name, sourcePreset, materialId });
};

// A Bambu Studio folder: a system base and filament, and a user preset over that filament.
function studioFolder() {
  const dir = mkdtempSync(join(tmpdir(), "preset-settings-"));
  const put = (rel: string, json: object) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(json));
  };
  put("system/BBL.json", { name: "Bambulab", version: "1" });
  put("system/BBL/filament/fdm_filament_common.json", {
    name: "fdm_filament_common",
    filament_type: ["PLA"],
    cool_plate_temp: ["35"],
    nozzle_temperature: ["200"],
  });
  put("system/BBL/filament/Bambu PLA Basic @BBL X1C.json", {
    name: "Bambu PLA Basic @BBL X1C",
    inherits: "fdm_filament_common",
    instantiation: "true",
    nozzle_temperature: ["220"],
  });
  put("user/default/filament/Mine.json", {
    name: "Mine",
    inherits: "Bambu PLA Basic @BBL X1C",
    cool_plate_temp: ["40"],
  });
  return dir;
}

test("a preset page lists every setting of its file, each with where it comes from", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "bambu-studio",
  });
  await app.api("PATCH", `/api/integrations/${id}`, { slicerConfigDir: studioFolder() });
  const system = await filament(app, "Bambu PLA Basic", "bambu-studio:system/Bambu PLA Basic");
  const user = await filament(app, "Mine", "bambu-studio:user/Mine");
  const gone = await filament(app, "Gone", "bambu-studio:system/Gone");

  // Presets were profiles before 5.5: an old link lands on the preset.
  await page.goto(`/filament/profiles/${system.id}`);
  await expect(page).toHaveURL(`/catalog/filament-presets/${system.id}`);
  const all = page.getByRole("region", { name: "All settings" });
  await expect(page.getByRole("heading", { name: "All settings" })).toBeVisible();
  const row = (key: string) => page.getByRole("row").filter({ hasText: key });
  // Its own value, and the one it inherits with the parent's name.
  await expect(row("nozzle_temperature")).toContainText("220");
  await expect(row("nozzle_temperature")).toContainText("This preset");
  await expect(row("cool_plate_temp")).toContainText("fdm_filament_common");

  // A layer chip narrows the list; the search narrows it further.
  await page.getByRole("button", { name: /^fdm_filament_common/ }).click();
  await expect(row("nozzle_temperature")).toHaveCount(0);
  await expect(row("cool_plate_temp")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search settings and values" }).fill("zzz");
  await expect(page.getByText('No setting matches "zzz".')).toBeVisible();

  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download JSON" }).click(),
  ]);
  expect(file.suggestedFilename()).toBe("Bambu PLA Basic.json");

  // A user preset shows its own value over its parent's, and each parent's the rest.
  await page.goto(`/catalog/filament-presets/${user.id}`);
  await expect(row("cool_plate_temp")).toContainText("40");
  await expect(row("cool_plate_temp")).toContainText("This preset");
  await expect(row("nozzle_temperature")).toContainText("Bambu PLA Basic @BBL X1C");
  await expect(row("filament_type")).toContainText("fdm_filament_common");

  // A preset the folder no longer has says so.
  await page.goto(`/catalog/filament-presets/${gone.id}`);
  await expect(page.getByRole("status")).toContainText("no longer has this preset");
  await expect(all).toBeVisible();
});

test("a slicer that isn't here says its files can't be read", async ({ page, app }) => {
  const preset = await filament(app, "Elsewhere", "bambu-studio:system/Elsewhere");
  await page.goto(`/catalog/filament-presets/${preset.id}`);
  await expect(page.getByRole("status")).toContainText("aren't available here");
  await expect(page.getByRole("link", { name: /in Integrations/ })).toBeVisible();
});
