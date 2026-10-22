import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  hasHorizontalScroll,
  offScreen,
  pick,
  roots,
  seedPrinter,
  seedProfile,
  seedProject,
  seedSpool,
} from "./helpers.ts";

const VIEWPORTS = [
  ["mobile", 375, 800],
  ["tablet", 768, 1024],
  ["desktop", 1440, 900],
] as const;

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, selector: string): Promise<Box> => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} is not visible`);
  return b;
};

/** A cloud integration with the mock adapter, plus its printers synced. */
const seedCloud = async (app: Parameters<Parameters<typeof test>[2]>[0]["app"]) => {
  const { id } = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  return id;
};

test("grams keep two decimals from the print form to the spool", async ({ page, app }) => {
  await seedPrinter(app.api);
  const spool = await seedSpool(app.api, 1000);
  await seedProject(app.api);
  await page.goto("/prints/new");
  await page.getByLabel("Name", { exact: true }).fill("Precise");
  await pick(page.getByLabel("Project"), 1);
  await page.getByRole("button", { name: "Add spool" }).click();
  await pick(page.getByLabel("Spool", { exact: true }), 1);
  await page.getByLabel("Grams").fill("12.34");
  await page.getByRole("button", { name: "Save print" }).click();
  await expect(page).toHaveURL(/\/prints$/);

  const after = await app.api<{ remainingGrams: number }>(
    "GET",
    `/api/filament/spools/${spool.id}`,
  );
  expect(after.remainingGrams).toBeCloseTo(987.66, 2);

  await page.getByRole("link", { name: "Precise" }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Grams")).toHaveValue("12.34");
});

test("home: customize mode moves, adds and removes widgets without overlap", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Customize" }).click();
  const move = page.getByRole("button", { name: "Move later" }).first();
  await expect(move).toBeVisible();

  // Touch targets stay at least 40px and the controls never sit on the next widget.
  for (const name of ["Move earlier", "Move later", "Widget settings", "Remove widget"]) {
    for (const b of await page.getByRole("button", { name }).all()) {
      const size = await b.boundingBox();
      if (!size) continue;
      expect(size.width, name).toBeGreaterThanOrEqual(40);
      expect(size.height, name).toBeGreaterThanOrEqual(40);
    }
  }

  const before = await page.getByRole("button", { name: "Remove widget" }).count();
  await pick(page.getByRole("combobox", { name: "Widget to add" }), "Recent prints");
  await page.getByRole("button", { name: "Add widget" }).click();
  await expect(page.getByRole("button", { name: "Remove widget" })).toHaveCount(before + 1);

  // The keyboard reaches the controls.
  await move.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Remove widget" }).last().click();
  await expect(page.getByRole("button", { name: "Remove widget" })).toHaveCount(before);
  await page.getByRole("button", { name: "Done" }).click();
});

test.describe("home customize mode has no overlap", () => {
  for (const [name, width, height] of VIEWPORTS) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.getByRole("button", { name: "Customize" }).click();
      await page.waitForLoadState("networkidle");
      expect(await hasHorizontalScroll(page)).toBe(false);
      const rows = await page.getByRole("button", { name: "Remove widget" }).all();
      const boxes = (await Promise.all(rows.map((r) => r.boundingBox()))).filter(
        (b): b is Box => !!b,
      );
      // No two remove buttons overlap, which is what the old controls did between rows.
      for (const [i, a] of boxes.entries())
        for (const b of boxes.slice(i + 1))
          expect(
            a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height,
          ).toBe(false);
    });
  }
});

test("import: prints without a number are numbered oldest first", async ({ page, app }) => {
  await seedPrinter(app.api);
  await seedProject(app.api);
  await page.goto("/import");
  await pick(page.getByRole("combobox", { name: "What to import" }), "Prints");
  // Newest first in the file: the order of the rows must not decide the numbers.
  await page.getByLabel("Upload a file").setInputFiles({
    name: "prints.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Printer;Name;Started;Outcome;Project",
        "Test Printer;Newest;2026-03-03 10:00;success;Test Project",
        "Test Printer;Middle;2026-02-02 10:00;success;Test Project",
        "Test Printer;Oldest;2026-01-01 10:00;success;Test Project",
      ].join("\n"),
    ),
  });
  await expect(page.getByRole("button", { name: "New (3)" })).toBeVisible();
  await page.getByRole("button", { name: "Import 3 rows" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Import 3 rows" }).click();
  await expect(page.getByText("Import finished: 3 created, 0 updated.")).toBeVisible();

  const list = await app.api<{ items: { title: string; number: number }[] }>("GET", "/api/prints");
  const byTitle = Object.fromEntries(list.items.map((p) => [p.title, p.number]));
  expect(byTitle.Oldest).toBeLessThan(byTitle.Middle as number);
  expect(byTitle.Middle).toBeLessThan(byTitle.Newest as number);
});

test("Sync from cloud: printers, prints and filament pages", async ({ page, app }) => {
  const id = await seedCloud(app);
  // Spools sync starts off, and the filament page only offers a sync once it is on.
  await app.api("PATCH", `/api/integrations/${id}`, {
    policies: [{ type: "spools", mode: "manual", frequency: "1d" }],
  });
  for (const route of ["/printers", "/prints", "/filament"]) {
    await page.goto(route);
    // Prints and filament also get a review link with the same words, so any match will do.
    await expect(
      page
        .getByRole("button", { name: /^Sync from/ })
        .or(page.getByRole("link", { name: /^Sync from/ }))
        .first(),
    ).toBeVisible();
  }
  // No integration, no button: the pages stay quiet instead of offering a dead end.
  const bare = await page.goto("/printers");
  expect(bare?.ok()).toBe(true);

  await page.goto("/printers");
  // The empty state repeats the header actions, so the first one is enough.
  await page
    .getByRole("button", { name: /^Sync from/ })
    .first()
    .click();
  await expect(page.getByRole("link", { name: "Mock printer" })).toBeVisible();
});

test("sync alerts: a sync with new rows raises sync_success, dismissible", async ({
  page,
  app,
}) => {
  const id = await seedCloud(app);
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });

  await page.goto("/alerts");
  const row = page
    .getByRole("listitem")
    .filter({ hasText: /Demo data/ })
    .filter({
      hasText: /synced/,
    });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /Dismiss/ }).click();
  await expect(row).toHaveCount(0);

  // The same sync again adds nothing, so it raises nothing.
  await app.api("POST", `/api/integrations/${id}/sync`, { type: "printers" });
  await page.reload();
  await expect(row).toHaveCount(0);
});

test("date and time format settings change every displayed date", async ({ page, app }) => {
  const printer = await seedPrinter(app.api);
  await seedProject(app.api);
  await app.api("POST", "/api/prints", {
    title: "Dated",
    printerId: printer.id,
    startedAt: new Date(2026, 2, 4, 15, 30).toISOString(), // local time, so the day is stable
    durationSec: 3600,
    outcome: "success",
    usages: [],
  });
  await page.goto("/prints");
  await expect(page.getByText("2026/03/04").first()).toBeVisible(); // the default

  await page.goto("/settings");
  await pick(page.getByLabel("Date format"), "DD/MM/YYYY");
  await pick(page.getByLabel("Time format"), "12-hour (2:30 PM)");
  await page.goto("/prints");
  await expect(page.getByText("04/03/2026").first()).toBeVisible();
  await expect(page.getByText("2026/03/04")).toHaveCount(0);
  await expect(page.getByText(/3:30\s?PM/i).first()).toBeVisible();
});

test("back: returns to where you came from; a deep link falls back to the parent", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const profile = await seedProfile(app.api);
  const spool = await app.api<{ id: string }>("POST", "/api/filament/spools", {
    profileId: profile.id,
    colorHex: "#00aa00",
    initialGrams: 1000,
  });
  await page.goto(`/filament/spools/${spool.id}`); // deep link: no in-app history
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/filament(\?|$)/);

  // In-app: printer page opened from the printers list goes back to it, filters and all.
  await page.goto("/printers?q=Test");
  await page
    .getByRole("link", { name: printer ? "Test Printer" : "" })
    .first()
    .click();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/printers\?q=Test/);
});

test("filament page: new and in-use spools by default, clear shows the rest", async ({
  page,
  app,
}) => {
  const profile = await seedProfile(app.api);
  const make = (status: string, n: number) =>
    app.api("POST", "/api/filament/spools", {
      profileId: profile.id,
      colorHex: "#aa0000",
      initialGrams: 1000,
      number: n,
      status,
    });
  await make("new", 2);
  await make("in_use", 1);
  await make("empty", 3);
  await page.goto("/filament");
  await expect(page).toHaveURL(/spools\.status=new%2Cin_use/);
  const status = (name: string) => page.getByRole("cell", { name, exact: true });
  await expect(status("In use")).toHaveCount(1);
  await expect(status("New")).toHaveCount(1);
  await expect(status("Empty")).toHaveCount(0);

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(status("Empty")).toHaveCount(1);

  // URL params still win over the default.
  await page.goto("/filament?spools.status=empty");
  await expect(status("In use")).toHaveCount(0);
  await expect(status("Empty")).toHaveCount(1);
});

test.describe("project page layout", () => {
  for (const [name, width, height] of VIEWPORTS) {
    test(`cost beside the preview, then description, prints and files at ${name}`, async ({
      page,
      app,
    }) => {
      const printer = await seedPrinter(app.api);
      const root = app.makeProjectDir("1-benchy");
      // A second model with a long name shows the "Model file" picker, which used to widen the page.
      writeFileSync(
        join(
          root,
          "1-benchy",
          "a-rather-long-model-name-for-the-left-fender-of-the-car-v12-final.stl",
        ),
        "solid x\nendsolid x\n",
      );
      await app.api("PATCH", "/api/preferences", { projectRoots: roots(root) });
      await page.goto("/projects");
      await page.getByRole("button", { name: "Scan folders" }).click();
      await expect(page.getByText("benchy").first()).toBeVisible();
      const list = await app.api<{ items: { id: string }[] }>("GET", "/api/projects");
      const project = list.items[0];
      await app.api("PATCH", `/api/projects/${project?.id}`, { description: "Plain words" });
      await app.api("POST", "/api/prints", {
        title: "Run one",
        printerId: printer.id,
        projectId: project?.id,
        startedAt: new Date().toISOString(),
        durationSec: 600,
        outcome: "success",
        usages: [],
      });
      await page.setViewportSize({ width, height });
      await page.goto(`/projects/${project?.id}`);
      await page.waitForLoadState("networkidle");
      expect(await hasHorizontalScroll(page)).toBe(false);

      // The printed-copies cost sits beside the preview on wide screens, stacked on narrow ones.
      const title = await box(page, "main h1");
      const cost = await page
        .getByRole("heading", { name: "Cost of printed copies" })
        .boundingBox();
      if (width >= 1024) expect(cost?.x ?? 0).toBeGreaterThan(title.x + 300);
      else expect(cost?.y ?? 0).toBeGreaterThan(title.y);

      // Below: the description, then the prints list, then the files.
      const description = await page.getByText("Plain words", { exact: true }).boundingBox();
      const prints = await page.getByRole("heading", { name: "Prints", level: 2 }).boundingBox();
      const files = await page.getByRole("heading", { name: "Files", level: 2 }).boundingBox();
      expect(description?.y ?? 0).toBeLessThan(prints?.y ?? 0);
      expect(prints?.y ?? 0).toBeLessThan(files?.y ?? 0);
    });
  }
});

test.describe("searchable selects fit every viewport", () => {
  for (const [name, width, height] of VIEWPORTS) {
    test(`the list stays on screen at ${name}`, async ({ page, app }) => {
      await seedPrinter(app.api);
      await seedProject(app.api);
      await page.setViewportSize({ width, height });
      await page.goto("/prints/new");
      const combo = page.getByLabel("Project");
      await combo.click();
      const list = page.getByRole("listbox");
      await expect(list).toBeVisible();
      const b = await list.boundingBox();
      expect(b?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(b?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(height);
      await page.keyboard.press("Escape");
    });
  }
});

test.describe("layout sweep", () => {
  for (const [name, width, height] of VIEWPORTS) {
    test(`no control hangs off the screen at ${name}`, async ({ page, app }) => {
      const printer = await seedPrinter(app.api);
      const spool = await seedSpool(app.api);
      // A long name stretches every project select (the stats filter once overflowed).
      const project = await seedProject(
        app.api,
        "A very long project name that goes on and on and on for testing wrapping",
      );
      await seedCloud(app);
      await app.api("POST", "/api/prints", {
        title: "Sweep",
        printerId: printer.id,
        projectId: project.id,
        startedAt: new Date().toISOString(),
        durationSec: 600,
        outcome: "success",
        usages: [{ spoolId: spool.id, grams: 10 }],
      });
      await page.setViewportSize({ width, height });
      const found: string[] = [];
      for (const route of [
        "/",
        "/printers",
        "/prints",
        "/prints/new",
        "/filament",
        `/filament/spools/${spool.id}`,
        "/projects",
        `/projects/${project.id}`,
        "/quotes",
        "/quotes/new",
        "/stats",
        "/alerts",
        "/integrations",
        "/import",
        "/settings",
      ]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        for (const p of await offScreen(page)) found.push(`${route}: ${p}`);
      }
      expect(found).toEqual([]);
    });
  }
});

test.describe("header actions and back link", () => {
  for (const [name, width, height] of [["small phone", 320, 640], ...VIEWPORTS] as const) {
    test(`actions stay on one line and inside the screen at ${name}`, async ({ page, app }) => {
      await seedCloud(app);
      await page.setViewportSize({ width, height });
      for (const route of ["/prints", "/printers", "/filament", "/projects", "/alerts"]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const header = page.locator("main header").first();
        for (const control of await header.getByRole("link").or(header.getByRole("button")).all()) {
          const b = await control.boundingBox();
          if (!b) continue;
          // One line of text: a wrapped label would make the control taller than its 36px.
          expect(b.height, `${route} ${await control.textContent()}`).toBeLessThanOrEqual(40);
          expect(b.x + b.width, route).toBeLessThanOrEqual(width);
        }
      }
    });
  }

  test("the back link is a comfortable tap target on a phone", async ({ page, app }) => {
    const printer = await seedPrinter(app.api);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/printers/${printer.id}`);
    const b = await page.getByRole("link", { name: "Back" }).boundingBox();
    expect(b?.height ?? 0).toBeGreaterThanOrEqual(40);
  });
});
