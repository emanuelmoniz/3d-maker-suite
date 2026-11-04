// Step 10 of the 5.3.0 plan, the parts that don't need a real account: the rest is covered by
// review-bulk-edit, review-tables and real-data (REAL_DB).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, openBulkEdit, pick, seedSpool } from "./helpers.ts";

const EDITOR = "00000000-0000-4000-8000-000000000002";

test("export, edit the file, upload it: the changed value is written without touching the review", async ({
  page,
  app,
}) => {
  const { id } = await seedSpool(app.api, 800);
  await page.goto("/import");
  const exportSection = page.getByRole("region", { name: "Export" });
  await pick(exportSection.getByRole("combobox", { name: "Format" }), "CSV (.csv)");
  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    exportSection.getByRole("button", { name: "Export" }).click(),
  ]);
  const file = join(mkdtempSync(join(tmpdir(), "3dms-csv-")), "spools.csv");
  await exported.saveAs(file);
  // Header first, then the one spool: set its Location cell in the file, as a person would.
  const [head, row] = readFileSync(file, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const sep = head.includes(";") ? ";" : ",";
  const cols = head.split(sep);
  const cells = row.split(sep);
  cells[cols.indexOf("Location")] = "Shelf 9";
  writeFileSync(file, [head, cells.join(sep)].join("\n"));

  await page.getByLabel("Upload a file").setInputFiles(file);
  await expect(page.getByRole("button", { name: "Changed (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Import 1 row" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 1 row" }).click();
  await expect(page.getByText("Import finished: 0 created, 1 updated.")).toBeVisible();
  const spool = await app.api<{ location: string | null }>("GET", `/api/filament/spools/${id}`);
  expect(spool.location).toBe("Shelf 9");
});

test("a write user on a phone assigns a spool in the filament queue", async ({ page, app }) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await app.api("PATCH", `/api/integrations/${id}`, {
    policies: [{ type: "prints", mode: "auto", frequency: "1h" }],
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });
  await seedSpool(app.api, 15);
  await page.goto(`/import/integration/${id}/prints`);
  // Import them with no project: they wait in the filament queue.
  const form = await openBulkEdit(page);
  await pick(form.getByRole("combobox", { name: "Project", exact: true }), "Set a value");
  await pick(
    form.getByRole("combobox", { name: "Value for Project" }),
    "No project (e.g. a calibration print)",
  );
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Import \d+ rows?$/ })
    .click();
  await expect(page.getByText(/^Import finished/)).toBeVisible();

  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana", email: "ana@example.com", password: "correct horse" },
  });
  await page.request.post("/api/users", {
    data: {
      displayName: "Wes",
      email: "wes@example.com",
      password: "correct horse",
      roleId: EDITOR,
    },
  });
  await page.context().clearCookies();
  await page.request.post("/api/auth/login", {
    data: { email: "wes@example.com", password: "correct horse" },
  });

  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/prints/review");
  await page.getByRole("checkbox", { name: "Select all matching rows, on every page" }).click();
  await page.getByRole("button", { name: "Assign a spool…" }).click();
  const dialog = page.getByRole("dialog");
  await pick(dialog.getByRole("combobox", { name: "Spool" }), 1);
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByText("Assigned 1 of 3")).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
});
