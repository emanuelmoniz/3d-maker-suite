import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { pick, seedModel } from "./helpers.ts";

test("export maintenance as CSV, edit the notes in the review and import it as an update", async ({
  page,
  app,
}) => {
  const printer = await app.api<{ id: string }>("POST", "/api/printers", {
    name: "Test Printer",
    modelId: (await seedModel(app.api)).id,
    state: "working",
  });
  const type = await app.api<{ id: string }>("POST", "/api/maintenance/types", {
    name: "Clean nozzle",
  });
  const task = await app.api<{ id: string }>("POST", "/api/maintenance/tasks", {
    typeId: type.id,
    printerId: printer.id,
    doneAt: "2026-03-01T10:00:00.000Z",
  });
  await page.goto("/import");
  await pick(page.getByRole("combobox", { name: "What to import" }), "Maintenance");
  const exportSection = page.getByRole("region", { name: "Export" });
  await pick(exportSection.getByRole("combobox", { name: "What to export" }), "Maintenance");
  await pick(exportSection.getByRole("combobox", { name: "Format" }), "CSV (.csv)");
  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    exportSection.getByRole("button", { name: "Export" }).click(),
  ]);
  const file = join(mkdtempSync(join(tmpdir(), "3dms-csv-")), "maintenance.csv");
  await exported.saveAs(file);

  await page.getByLabel("Upload a file").setInputFiles(file);
  await expect(page.getByRole("button", { name: "Identical (1)" })).toBeVisible();
  await page.getByRole("button", { name: /^Edit Notes, row 2/ }).click();
  await page.getByRole("textbox", { name: "Notes, row 2" }).fill("New nozzle");
  await page.keyboard.press("Enter");
  await pick(page.getByRole("combobox", { name: "Action for row 2" }), "Update");
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 0 created, 1 updated.")).toBeVisible();
  const { items } = await app.api<{ items: { id: string; notes: string | null }[] }>(
    "GET",
    "/api/maintenance/tasks",
  );
  expect(items.find((t) => t.id === task.id)?.notes).toBe("New nozzle");
});
