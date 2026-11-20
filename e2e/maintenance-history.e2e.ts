import { expect, test } from "./fixtures.ts";
import { seedPrinter } from "./helpers.ts";

test("maintenance history: listed on the task and the printer, edit a record, delete one", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const type = await app.api<{ id: string }>("POST", "/api/maintenance/types", {
    name: "Clean nozzle",
    target: "printer",
    intervalDays: 30,
  });
  for (const [doneAt, notes] of [
    ["2026-02-01T12:00:00.000Z", "first"],
    ["2026-04-01T12:00:00.000Z", "second"],
  ])
    await app.api("POST", "/api/maintenance/tasks", {
      printerId: printer.id,
      typeId: type.id,
      doneAt,
      cost: 450,
      notes,
    });

  await page.goto(`/maintenance/types/${type.id}`);
  const table = page.getByRole("table", { name: "Maintenance history" });
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(3); // header + 2
  await expect(rows.nth(1)).toContainText("second");
  await expect(rows.nth(2)).toContainText("first");

  // Fix a note and the cost.
  await rows.nth(1).getByRole("button", { name: "Edit record" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Notes").fill("corrected");
  await dialog.getByLabel(/Cost/).fill("12.5");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(rows.nth(1)).toContainText("corrected");

  // The printer's page lists the same records.
  await page.goto(`/printers/${printer.id}`);
  const onPrinter = page.getByRole("table", { name: "Maintenance history" });
  await expect(onPrinter.getByRole("row")).toHaveCount(3);

  // Delete the latest: the confirmation says what happens to the due date.
  await onPrinter.getByRole("row").nth(1).getByRole("button", { name: "Delete record" }).click();
  await expect(page.getByRole("dialog")).toContainText("count from the previous record");
  await page.getByRole("dialog").getByRole("button", { name: "Delete record" }).click();
  await expect(onPrinter.getByRole("row")).toHaveCount(2);
  await expect(onPrinter).toContainText("first");
});
