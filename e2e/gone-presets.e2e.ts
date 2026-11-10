import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";

type Preset = { id: string; name: string };

test("a preset gone from the slicer waits for a person, who deletes its row", async ({
  page,
  app,
}) => {
  // An OrcaSlicer folder with two user filament presets.
  const dir = mkdtempSync(join(tmpdir(), "gone-presets-"));
  const filament = join(dir, "user", "default", "filament");
  mkdirSync(filament, { recursive: true });
  for (const name of ["Mine", "Other"])
    writeFileSync(
      join(filament, `${name}.json`),
      JSON.stringify({ name, filament_type: ["PLA"], filament_vendor: ["Acme"] }),
    );
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "orca-slicer",
  });
  await app.api("PATCH", `/api/integrations/${id}`, { slicerConfigDir: dir });
  const sync = () =>
    app.api("POST", `/api/integrations/${id}/sync`, { type: "userFilamentPresets" });
  const names = async () =>
    (await app.api<{ items: Preset[] }>("GET", "/api/filament/presets")).items.map((p) => p.name);
  await sync();
  expect((await names()).sort()).toEqual(["Mine", "Other"]);

  // Removed in the slicer: the run deletes nothing.
  rmSync(join(filament, "Mine.json"));
  await sync();
  expect((await names()).sort()).toEqual(["Mine", "Other"]);

  await page.goto(`/import/integration/${id}/userFilamentPresets`);
  const gone = page.getByRole("region", { name: "Gone from the slicer" });
  await expect(gone.getByText(/Mine/)).toBeVisible();
  await gone.getByRole("button", { name: /^Delete .*Mine/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(/Delete .*Mine/);
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(gone).toBeHidden();
  expect(await names()).toEqual(["Other"]);
});
