import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { pick, seedModel, seedProfile } from "./helpers.ts";

type Plate = { index: number; name: string | null };

test("project slicing setup: defaults from the default printer, saves, reloads, marks a changed file", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  mkdirSync(join(root, "Benchy"), { recursive: true });
  const file = join(root, "Benchy", "benchy.3mf");
  copyFileSync(join(import.meta.dirname, "../packages/3mf/fixtures/multi_color.3mf"), file);
  await app.api("PATCH", "/api/preferences", { projectRoots: [root] });
  const project = await app.api<{ id: string; meta: { models: { plates: Plate[] }[] } }>(
    "POST",
    "/api/projects",
    { name: "Benchy", folderPath: join(root, "Benchy") },
  );
  const first = project.meta.models[0]?.plates[0] as Plate;
  const plateName = first.name ?? `Plate ${first.index}`;

  const model = await seedModel(app.api);
  const standard = await app.api<{ id: string }>("POST", "/api/print-profiles", {
    name: "0.20mm Standard",
    printerModelId: model.id,
  });
  await app.api("POST", "/api/print-profiles", { name: "0.12mm Fine" });
  const printer = await app.api<{ id: string }>("POST", "/api/printers", {
    name: "Main",
    modelId: model.id,
    state: "working",
    printProfileId: standard.id,
  });
  await app.api("PATCH", "/api/preferences", { defaultPrinterId: printer.id });
  await seedProfile(app.api);

  await page.goto(`/projects/${project.id}`);
  const section = page.getByRole("region", { name: "Slicing setup" });
  await section.getByRole("checkbox", { name: /benchy\.3mf/ }).check();
  const printProfile = section.getByRole("combobox", { name: `Print profile for ${plateName}` });
  await expect(printProfile).toHaveValue("Default (0.20mm Standard)");

  await pick(printProfile, "0.12mm Fine");
  const slot1 = section.getByRole("combobox", { name: `Filament for ${plateName}, slot 1` });
  await pick(slot1, "Basic");
  await section.getByRole("button", { name: "Save setup" }).click();
  await expect(section.getByRole("status")).toHaveText("Saved.");

  await page.reload();
  await expect(printProfile).toHaveValue("0.12mm Fine");
  await expect(slot1).toHaveValue("Basic");
  await expect(section.getByText("The file changed since this setup was saved")).toHaveCount(0);

  appendFileSync(file, "changed");
  await page.reload();
  await expect(
    section.getByText("The file changed since this setup was saved").first(),
  ).toBeVisible();
});
