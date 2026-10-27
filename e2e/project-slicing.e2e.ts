import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { addRoots, openSections, pick, seedModel, seedProfile, seedSpool } from "./helpers.ts";

type Plate = { index: number; name: string | null };

test("project slicing setup: defaults from the default printer, saves, reloads, marks a changed file", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  mkdirSync(join(root, "Benchy"), { recursive: true });
  const file = join(root, "Benchy", "benchy.3mf");
  copyFileSync(join(import.meta.dirname, "../packages/3mf/fixtures/multi_color.3mf"), file);
  await addRoots(app.api, root);
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
  await app.api("POST", "/api/print-profiles", { name: "0.12mm Fine", printerModelId: model.id });
  const printer = await app.api<{ id: string }>("POST", "/api/printers", {
    name: "Main",
    modelId: model.id,
    state: "working",
    printProfileId: standard.id,
  });
  await app.api("PATCH", "/api/preferences", { defaultPrinterId: printer.id });
  await seedProfile(app.api);

  await page.goto(`/projects/${project.id}/edit`);
  await openSections(page, "Print setup");
  const section = page.getByRole("region", { name: "Print setup" });
  await section.getByRole("checkbox", { name: /benchy\.3mf/ }).check();
  const printProfile = section.getByRole("combobox", { name: `Print profile for ${plateName}` });
  // "Acme X1" isn't the A1 the file was made for: its default profile, and only its profiles.
  await expect(section.getByRole("combobox", { name: `Printer for ${plateName}` })).toHaveValue(
    /Main/,
  );
  await expect(printProfile).toHaveValue("Printer default (0.20mm Standard)");

  await pick(printProfile, "0.12mm Fine");
  const slot1 = section.getByRole("combobox", { name: `Filament for ${plateName}, slot 1` });
  await pick(slot1, "Basic");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`));

  await page.goto(`/projects/${project.id}/edit`);
  await openSections(page, "Print setup");
  await expect(printProfile).toHaveValue("0.12mm Fine");
  await expect(slot1).toHaveValue("Basic");
  await expect(section.getByText("The file changed since this setup was saved")).toHaveCount(0);

  appendFileSync(file, "changed");
  await page.reload();
  await openSections(page, "Print setup");
  await expect(
    section.getByText("The file changed since this setup was saved").first(),
  ).toBeVisible();

  // Deep link: the project page opens the edit page at Print setup, already open; the rest is closed.
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("link", { name: "Print setup" }).click();
  await expect(section.getByRole("checkbox", { name: /benchy\.3mf/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" })).toBeHidden();
});

test("slicing a project with the mock slicer: results, estimate, list filter, re-slice", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  mkdirSync(join(root, "Benchy"), { recursive: true });
  const file = join(root, "Benchy", "benchy.3mf");
  copyFileSync(join(import.meta.dirname, "../packages/3mf/fixtures/multi_color.3mf"), file);
  // Auto slicing off: this test slices by hand (auto-slice.e2e.ts covers the other way).
  await addRoots(app.api, { path: root, autoSlice: false });
  const project = await app.api<{ id: string }>("POST", "/api/projects", {
    name: "Benchy",
    folderPath: join(root, "Benchy"),
  });
  // The mock slicer never runs its program, but slicing needs one that exists.
  const mock = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${mock.id}`, { slicerPath: process.execPath });
  await seedSpool(app.api);

  await page.goto(`/projects/${project.id}/edit`);
  await openSections(page, "Print setup");
  const section = page.getByRole("region", { name: "Print setup" });
  await section.getByRole("checkbox", { name: /benchy\.3mf/ }).check();
  // No printer: the file's own print profile, named after the 3MF's preset.
  await expect(section.getByRole("combobox", { name: /^Print profile for/ })).toHaveValue(
    "As saved in the file (0.20mm Standard @BBL A1)",
  );
  // Slot 1 from the spool (the first entry after "As saved in the file").
  await pick(section.getByRole("combobox", { name: /, slot 1$/ }), 1);
  const slice = section.getByRole("button", { name: "Slice" });
  await expect(slice).toBeEnabled(); // an unsaved setup: Slice saves it first
  await slice.click();
  // Plate 1 of the fixture: 1 h, 10 g per slot (see `fakeSlice`).
  await expect(section.getByText(/^1h · \d+ g$/).first()).toBeVisible();
  await expect(section.getByText("Every plate is sliced and up to date.")).toBeVisible();
  await expect(slice).toBeDisabled();

  // The project page shows the results: on the plate cards and in the estimate.
  await page.goto(`/projects/${project.id}`);
  const plates = page.getByRole("region", { name: "Plates" });
  await plates.getByRole("heading", { name: "Plates" }).click();
  await expect(plates.getByText(/^1h · \d+ g$/).first()).toBeVisible();
  await expect(plates.getByText("Not sliced")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Production cost of one print" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Material usage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aggregated cost" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: /^001-Basic #ff0000$/ })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: /^Total PLA$/ })).toBeVisible();

  await page.goto("/projects?slicing=done");
  await expect(page.getByRole("link", { name: /Benchy/ }).first()).toBeVisible();
  await page.goto("/projects?slicing=needed");
  await expect(page.getByText("No projects match these filters.")).toBeVisible();

  // The file changes on disk: that plate needs slicing again.
  appendFileSync(file, "changed");
  await page.goto(`/projects/${project.id}/edit`);
  await openSections(page, "Print setup");
  await expect(slice).toBeEnabled();
  await slice.click();
  await expect(section.getByText("Every plate is sliced and up to date.")).toBeVisible();
});

test("plate pickers list the slicer's presets, slots default to the file's, misfits warn", async ({
  page,
  app,
}) => {
  const root = join(app.dataDir, "models");
  mkdirSync(join(root, "Benchy"), { recursive: true });
  copyFileSync(
    join(import.meta.dirname, "../packages/3mf/fixtures/multi_color.3mf"),
    join(root, "Benchy", "benchy.3mf"),
  );
  await addRoots(app.api, { path: root, autoSlice: false });
  const project = await app.api<{ id: string }>("POST", "/api/projects", {
    name: "Benchy",
    folderPath: join(root, "Benchy"),
  });
  const mock = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${mock.id}`, { slicerPath: process.execPath });
  const model = await seedModel(app.api);
  // The mock slicer's preset, another slicer's, and a hand-made one (no slicer's).
  for (const [name, sourcePreset] of [
    ["Fine", "mock:system/Fine"],
    ["Orca Fine", "orca-slicer:system/Fine"],
    ["Mine", undefined],
  ])
    await app.api("POST", "/api/print-profiles", { name, printerModelId: model.id, sourcePreset });
  const mine = await app.api<{ items: { id: string; name: string }[] }>(
    "GET",
    "/api/print-profiles?name=Mine",
  );
  // Not the file's printer (an A1): it slices with its default profile, the hand-made one.
  await app.api("PATCH", "/api/preferences", {
    defaultPrinterId: (
      await app.api<{ id: string }>("POST", "/api/printers", {
        name: "Main",
        modelId: model.id,
        state: "working",
        printProfileId: mine.items[0]?.id,
      })
    ).id,
  });

  await page.goto(`/projects/${project.id}/edit`);
  await openSections(page, "Print setup");
  const section = page.getByRole("region", { name: "Print setup" });
  await section.getByRole("checkbox", { name: /benchy\.3mf/ }).check();
  await expect(section.getByRole("combobox", { name: /, slot 1$/ })).toHaveValue(
    /^As saved in the file \(.+\)$/,
  );
  const warning = section.getByText(/has no preset for “Mine”, so this plate won't slice/).first();
  await expect(warning).toBeVisible();

  const printProfile = section.getByRole("combobox", { name: /^Print profile for/ }).first();
  await printProfile.click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.getByText("Fine", { exact: true })).toBeVisible();
  await expect(options.getByText("Orca Fine", { exact: true })).toHaveCount(0);
  await expect(options.getByText("Mine", { exact: true })).toHaveCount(0);
  await options.getByText("Fine", { exact: true }).click();
  await expect(warning).toHaveCount(0);
});
