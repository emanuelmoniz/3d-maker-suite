import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  addRoots,
  gotoIntegrations,
  hasHorizontalScroll,
  openSections,
  pick,
  roots,
  savedRoots,
  seedModel,
  seedPrinter,
  seedProfile,
  seedProject,
} from "./helpers.ts";

// exceljs is the server's dependency; the tests only borrow it to read a template.
const ExcelJS = createRequire(join(import.meta.dirname, "..", "apps", "server", "package.json"))(
  "exceljs",
) as typeof import("exceljs");

const dialog = (page: Page) => page.getByRole("dialog");

/** Makes `<tmp>/<name>/` with the given subfolders and files; returns the folder. */
const makeTree = (name: string, folders: string[], files: string[] = []) => {
  const root = join(mkdtempSync(join(tmpdir(), "3dms-pick-")), name);
  for (const f of folders) mkdirSync(join(root, f), { recursive: true });
  mkdirSync(root, { recursive: true });
  for (const f of files) writeFileSync(join(root, f), "x");
  return root;
};

test("every module page has a gear that opens its config page and links back", async ({ page }) => {
  for (const module of ["Quotes", "Prints", "Projects", "Alerts", "Printers", "Filament"]) {
    await page.goto(`/${module.toLowerCase()}`);
    await page.getByRole("link", { name: `${module} settings` }).click();
    await expect(page).toHaveURL(new RegExp(`/${module.toLowerCase()}/settings$`));
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page).toHaveURL(new RegExp(`/${module.toLowerCase()}(\\?|$)`));
  }
});

test("the gear is reachable and activated from the keyboard", async ({ page }) => {
  await page.goto("/quotes");
  await page.getByRole("link", { name: "Quotes settings" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/quotes\/settings$/);
});

test("config pages: printers and filament hold the catalogs, the module pages don't", async ({
  page,
}) => {
  await page.goto("/printers");
  await expect(page.getByRole("heading", { name: "Brands", level: 2 })).toHaveCount(0);
  await page.goto("/printers/settings");
  for (const h of ["Brands", "Printer models", "Machine profiles"])
    await expect(page.getByRole("heading", { name: h, level: 2 })).toBeVisible();
  await page.goto("/filament/settings");
  for (const h of ["Profiles", "Filament brands", "Filament materials"])
    await expect(page.getByRole("heading", { name: h, level: 2 })).toBeVisible();
});

test("printer settings tables show each row's slicer", async ({ page, app }) => {
  const model = await seedModel(app.api);
  await app.api("POST", "/api/machine-profiles", {
    name: "Acme X1 0.4 nozzle",
    printerModelId: model.id,
    nozzleDiameterMm: 0.4,
    sourcePreset: "bambu-studio:system/Acme X1 0.4 nozzle",
  });
  await app.api("POST", "/api/print-profiles", { name: "Mine", printerModelId: model.id });
  await page.goto("/printers/settings");
  for (const table of ["Brands", "Printer models", "Machine profiles", "Print profiles"]) {
    const t = page.getByRole("table", { name: table });
    await expect(t.getByRole("columnheader", { name: "Slicer" })).toBeVisible();
  }
  // Brand and model: their profiles' slicers. A hand-made profile has none.
  for (const table of ["Brands", "Printer models", "Machine profiles"])
    await expect(page.getByRole("table", { name: table }).getByText("Bambu Studio")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Print profiles" }).getByRole("row", { name: /Mine/ }),
  ).not.toContainText("Bambu Studio");
});

test("path picker: project roots are filled by browsing, keyboard included", async ({
  page,
  app,
}) => {
  const root = makeTree("pick", ["alpha", "beta"]);
  await addRoots(app.api, root);
  await page.goto("/projects/settings");
  await page.getByRole("button", { name: /^Browse for/ }).click();
  await expect(dialog(page).getByRole("button", { name: "alpha" })).toBeVisible();
  // Focus moves into the list, so Enter on the first entry opens it.
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("navigation", { name: "Location" })).toContainText("alpha");
  await dialog(page).getByRole("button", { name: "Select this folder" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(async () => await savedRoots(app.api))
    .toEqual(roots(root, join(root, "alpha")));
  // Escape closes without choosing.
  await page.getByRole("button", { name: /^Browse for/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
});

test("path picker: the slicer program and config folder come from the picker", async ({
  page,
  app,
}) => {
  const dir = makeTree("orca", ["presets"], ["old.exe", "new.exe"]);
  await app.api("POST", "/api/integrations", { adapterId: "orca-slicer" });
  const [orca] = await app.api<{ id: string }[]>("GET", "/api/integrations");
  await app.api("PATCH", `/api/integrations/${orca?.id}`, {
    slicerPath: join(dir, "old.exe"),
    slicerConfigDir: dir,
  });
  await gotoIntegrations(page);
  await page.getByText("Slicer", { exact: true }).click(); // closed by default

  await page.getByRole("button", { name: "Browse for Slicer program" }).click();
  await dialog(page).getByRole("button", { name: "new.exe" }).click();
  await expect(page.getByRole("textbox", { name: "Slicer program" })).toHaveValue(
    join(dir, "new.exe"),
  );

  await page.getByRole("button", { name: "Browse for Config folder" }).click();
  await dialog(page).getByRole("button", { name: "presets" }).click();
  await dialog(page).getByRole("button", { name: "Select this folder" }).click();
  await expect(page.getByRole("textbox", { name: "Config folder" })).toHaveValue(
    join(dir, "presets"),
  );
});

test("projects: add a project from a folder, link a description file, edit by hand unlinks", async ({
  page,
  app,
}) => {
  const parent = app.makeProjectDir("Bracket");
  const notes = "Hello **world**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![Pic](img/pic.png)\n";
  writeFileSync(join(parent, "Bracket", "notes.md"), notes);
  mkdirSync(join(parent, "Bracket", "img"));
  copyFileSync(
    join(import.meta.dirname, "../docs/images/dashboard.png"),
    join(parent, "Bracket", "img", "pic.png"),
  );
  await addRoots(app.api, parent);

  await page.goto("/projects");
  await app.api("POST", "/api/projects", { name: "Bracket", folderPath: join(parent, "Bracket") });
  await page.reload();
  await expect(page.getByRole("link", { name: "Bracket" }).first()).toBeVisible();

  const list = await app.api<{ items: { id: string; description: string | null }[] }>(
    "GET",
    "/api/projects",
  );
  const project = list.items[0];
  expect(project?.description ?? "").toBe(""); // the scanner no longer fills it from the README

  await page.goto(`/projects/${project?.id}/edit`);
  await openSections(page, "Project info");
  await pick(page.getByLabel("Project info file"), "notes.md");
  // The file's text shows at once, in the editor and the preview.
  await expect(page.getByLabel("Editor", { exact: true })).toHaveValue(notes);
  await expect(
    page.getByRole("region", { name: "Preview" }).locator("strong", { hasText: "world" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await page.goto(`/projects/${project?.id}`);
  await expect(page.getByRole("heading", { name: "Project info" })).toBeVisible();
  await expect(page.getByText("Hello")).toBeVisible();
  // Tables and images next to the file (served from the project folder).
  await expect(page.getByRole("table")).toContainText("1");
  const pic = page.getByRole("img", { name: "Pic" });
  await expect(pic).toHaveAttribute("src", /\/file\?path=img%2Fpic\.png/);
  await expect.poll(() => pic.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator("strong", { hasText: "world" })).toBeVisible();

  await page.goto(`/projects/${project?.id}/edit`);
  await openSections(page, "Project info");
  await pick(page.getByLabel("Project info file"), "None");
  await page.getByLabel("Editor", { exact: true }).fill("By hand");
  await page.getByRole("button", { name: "Save" }).click();
  const after = await app.api<{ description: string; descriptionFile: string | null }>(
    "GET",
    `/api/projects/${project?.id}`,
  );
  expect(after).toMatchObject({ description: "By hand", descriptionFile: null });
});

test("projects: the description editor writes the .md file and the preview file choice sticks", async ({
  page,
  app,
}) => {
  const parent = app.makeProjectDir("Gadget");
  const dir = join(parent, "Gadget");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "extra.stl"), "solid");
  rmSync(join(dir, "README.md")); // so "New file…" suggests README.md
  await addRoots(app.api, parent);
  await app.api("POST", "/api/projects/scan");
  await expect
    .poll(async () => (await app.api<{ items: unknown[] }>("GET", "/api/projects")).items.length)
    .toBe(1);
  const { items } = await app.api<{ items: { id: string }[] }>("GET", "/api/projects");
  const id = items[0]?.id;

  await page.goto(`/projects/${id}/edit`);
  await openSections(page, "Project info", "Preview and gallery");
  const editor = page.getByLabel("Editor", { exact: true });
  await editor.fill("# Gadget");
  await pick(page.getByLabel("Project info file"), "New file…");
  const create = dialog(page);
  await expect(create.getByLabel("File name")).toHaveValue("README.md");
  await create.getByLabel("File name").fill("notes");
  await pick(create.getByLabel("Folder"), "sub");
  await create.getByRole("button", { name: "Create file" }).click();
  // Made with the text so far, and picked.
  await expect(page.getByLabel("Project info file")).toHaveValue("sub/notes.md");
  expect(readFileSync(join(dir, "sub", "notes.md"), "utf8")).toBe("# Gadget");

  await editor.fill("# Gadget\n\nMade **fast**");
  await expect(page.locator("strong", { hasText: "fast" })).toBeVisible(); // live preview
  await pick(page.getByLabel("Preview file"), "sub/extra.stl");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
  await page.goto(`/projects/${id}/edit`);
  await openSections(page, "Preview and gallery");
  await expect(page.getByLabel("Preview file")).toHaveValue("sub/extra.stl"); // survives a reload

  expect(readFileSync(join(dir, "sub", "notes.md"), "utf8")).toBe("# Gadget\n\nMade **fast**");
  await app.api("POST", "/api/projects/scan");
  const after = await app.api<{ description: string; filePath: string }>(
    "GET",
    `/api/projects/${id}`,
  );
  expect(after.description).toBe("# Gadget\n\nMade **fast**");
  expect(after.filePath).toBe("sub/extra.stl");
});

test("spools: automatic numbers, taken numbers are refused, color name shows in the name", async ({
  page,
  app,
}) => {
  const profile = await seedProfile(app.api);
  const make = (extra: object = {}) =>
    app.api<{ id: string; number: number }>("POST", "/api/filament/spools", {
      profileId: profile.id,
      colorHex: "#cc0000",
      initialGrams: 500,
      ...extra,
    });
  const first = await make();
  const second = await make({ colorName: "Scarlet Red" });
  expect([first.number, second.number]).toEqual([1, 2]);

  await page.goto(`/filament/spools/${second.id}/edit`);
  await page.getByLabel("Number").fill("1");
  await page.getByRole("button", { name: "Save spool" }).click();
  await expect(page.getByText("Another spool already has this number.")).toBeVisible();
  await page.getByLabel("Number").fill("7");
  await page.getByRole("button", { name: "Save spool" }).click();
  await expect(page).toHaveURL(new RegExp(`/filament/spools/${second.id}$`));
  await expect(page.getByText(/0*7-.*Scarlet Red/).first()).toBeVisible();

  // The import template's spool list uses the same display name.
  const res = await fetch(`${app.url}/api/import/prints/template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      labels: {},
      sheets: { data: "Data", lists: "Lists", instructions: "Instructions" },
      instructions: [["x"]],
    }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await res.arrayBuffer()) as never);
  const cells: string[] = [];
  for (const sheet of book.worksheets)
    sheet.eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
  expect(cells.some((c) => /^0*7-.*Scarlet Red$/.test(c))).toBe(true);
});

test("estimated duration: button fills it, list shows ~, a real value clears it", async ({
  page,
  app,
}) => {
  await seedPrinter(app.api);
  const profile = await seedProfile(app.api);
  const spool = await app.api<{ id: string }>("POST", "/api/filament/spools", {
    profileId: profile.id,
    colorHex: "#00aa00",
    initialGrams: 1000,
  });
  await seedProject(app.api);
  await page.goto("/prints/new");
  await page.getByLabel("Name", { exact: true }).fill("Estimated");
  await pick(page.getByLabel("Project"), 1);
  await expect(page.getByRole("button", { name: "Estimate from filament" })).toBeDisabled();
  await page.getByRole("button", { name: "Add spool" }).click();
  await pick(page.getByLabel("Spool", { exact: true }), 1);
  await page.getByLabel("Grams").fill("60");
  await page.getByRole("button", { name: "Estimate from filament" }).click();
  await expect(page.getByLabel("Hours")).not.toHaveValue("");
  await page.getByRole("button", { name: "Save print" }).click();
  await expect(page).toHaveURL(/\/prints$/);
  await expect(page.getByText(/^~\d/)).toBeVisible();
  expect(spool.id).toBeTruthy();

  await page.getByRole("link", { name: "Estimated" }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Hours").fill("2");
  await page.getByLabel("Minutes").fill("0");
  await page.getByRole("button", { name: "Save print" }).click();
  await page.goto("/prints");
  await expect(page.getByText(/^~\d/)).toHaveCount(0);
  await expect(page.getByText("2h")).toBeVisible();
});

test("sync_pending alert: raised by an auto sync, Review opens the queue, toggle removes it", async ({
  page,
  app,
}) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  // No spool matches the mock prints' orange PLA, so an automatic run leaves them for review.
  await app.api("PATCH", `/api/integrations/${id}`, {
    policies: [{ type: "prints", mode: "auto", frequency: "1h" }],
  });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "prints" });

  await page.goto("/alerts");
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "waiting for your review" })
    .or(page.getByRole("listitem").filter({ hasText: "wait for your review" }));
  await expect(row).toHaveCount(1);
  // The list has no Review button: it is on the alert.
  await expect(row.getByRole("link", { name: "Review", exact: true })).toHaveCount(0);
  await row.getByRole("link").click();
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/import/integration/${id}/prints(\\?waiting=1)?$`));

  await gotoIntegrations(page);
  await page.getByRole("button", { name: "Settings: Print history" }).click();
  const toggle = page.getByLabel("Alert on Review: Print history");
  await toggle.click(); // saved on the server first, so the box flips after the round trip
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => {
      const list = await app.api<{ items?: { kind: string }[] } | { kind: string }[]>(
        "GET",
        "/api/alerts",
      );
      const items = Array.isArray(list) ? list : (list.items ?? []);
      return items.filter((a) => a.kind === "sync_pending").length;
    })
    .toBe(0);
});

test.describe("v1.2 pages fit every viewport", () => {
  for (const width of [375, 768, 1440]) {
    test(`no horizontal scroll and a reachable gear at ${width}px`, async ({ page, app }) => {
      await seedPrinter(app.api);
      await seedProfile(app.api);
      await app.api("POST", "/api/integrations", { adapterId: "orca-slicer" });
      await page.setViewportSize({ width, height: 900 });
      const bad: string[] = [];
      for (const route of [
        "/quotes/settings",
        "/prints/settings",
        "/projects/settings",
        "/alerts/settings",
        "/printers/settings",
        "/filament/settings",
        "/projects",
        "/prints/new",
        "/filament/spools/new",
        "/integrations",
        "/alerts",
      ]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        if (await hasHorizontalScroll(page)) bad.push(route);
      }
      expect(bad).toEqual([]);

      // The picker modal fits too.
      await page.goto("/projects/settings");
      await page
        .getByRole("button", { name: /^Browse for/ })
        .first()
        .click();
      const box = await dialog(page).boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
    });
  }
});

test("filament settings tables show each row's slicer", async ({ page, app }) => {
  const imported = await seedProfile(app.api); // Acme / PLA
  const brand = await app.api<{ id: string }>("POST", "/api/filament-brands", { name: "Handmade" });
  const material = await app.api<{ id: string }>("POST", "/api/filament-materials", {
    name: "PETG",
  });
  await app.api("POST", "/api/filament/profiles", {
    brandId: brand.id,
    materialId: material.id,
    densityGcm3: 1.27,
    name: "Mine",
  });
  // The API can't set a preset (only the slicer import does): mark the first one as imported.
  const db = new DatabaseSync(join(app.dataDir, "app.sqlite"));
  db.prepare("UPDATE filament_profiles SET source_preset = ? WHERE id = ?").run(
    "bambu-studio:system/Basic",
    imported.id,
  );
  db.close();
  await page.goto("/filament/settings");
  // No import buttons any more, only "Add ...".
  await expect(page.getByRole("main").getByRole("link", { name: /^Import / })).toHaveCount(0);
  for (const table of ["Filament profiles", "Filament brands", "Filament materials"])
    await expect(
      page.getByRole("table", { name: table }).getByRole("columnheader", { name: "Slicer" }),
    ).toBeVisible();
  // Profile, brand and material of the imported one show its slicer; the hand-made ones none.
  for (const [table, name] of [
    ["Filament profiles", /Basic/],
    ["Filament brands", /Acme/],
    ["Filament materials", /PLA/],
  ] as const)
    await expect(page.getByRole("table", { name: table }).getByRole("row", { name })).toContainText(
      "Bambu Studio",
    );
  for (const [table, name] of [
    ["Filament profiles", /Mine/],
    ["Filament brands", /Handmade/],
    ["Filament materials", /PETG/],
  ] as const)
    await expect(
      page.getByRole("table", { name: table }).getByRole("row", { name }),
    ).not.toContainText("Bambu Studio");
});
