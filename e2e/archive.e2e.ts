import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { hasHorizontalScroll, seedModel, seedPrinter, seedProject, seedSpool } from "./helpers.ts";

const SELECT_ALL = "Select all matching rows, on every page";

test("archived rows still show where a row points at them, and pickers keep only those", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const model = await seedModel(app.api);
  const project = await seedProject(app.api, "Lamp");
  const client = await app.api<{ id: string }>("POST", "/api/clients", {
    name: "Ana",
    mobile: "911",
  });
  await app.api("POST", "/api/orders", {
    projectIds: [project.id],
    clientId: client.id,
    price: 100,
  });

  await app.api("PATCH", `/api/printer-models/${model.id}`, { archived: true });
  await app.api("PATCH", `/api/clients/${client.id}`, { archived: true });
  await app.api("PATCH", `/api/projects/${project.id}`, { archived: true });

  // The printer still names its model, and its form still has it picked.
  await page.goto(`/printers/${printer.id}`);
  await expect(page.getByText("Acme X1").first()).toBeVisible();
  await page.goto(`/printers/${printer.id}/edit`);
  await expect(page.getByLabel("Model")).toHaveValue(/X1/);

  // A new printer's form doesn't offer it.
  await page.goto("/printers/new");
  await page.getByLabel("Model").click();
  await expect(page.getByRole("option", { name: "X1" })).toHaveCount(0);

  // The order still names its client and project; the clients list doesn't show the client.
  await page.goto("/orders");
  await expect(page.getByRole("link", { name: "Ana" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Lamp/ })).toBeVisible();
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Ana" })).toHaveCount(0);
});

test("a quote whose form names deleted rows still opens and saves", async ({ page, app }) => {
  const printer = await seedPrinter(app.api);
  const project = await seedProject(app.api, "Lamp");
  const spool = await seedSpool(app.api);
  const plate = {
    file: "lamp.3mf",
    plate: 1,
    printerId: printer.id,
    printProfileId: null,
    useDefaultPrintProfile: false,
    filaments: [],
    spools: [spool.id],
    slicerIntegrationId: null,
    result: null,
  };
  const quote = await app.api<{ id: string }>("POST", "/api/costs/quotes", {
    name: "Lamp quote",
    form: { projectId: project.id, printerId: printer.id, plates: [plate] },
    cost: { material: 1, energy: 1, wear: 0, maintenance: 0, total: 2, unpricedGrams: 0 },
    quote: {
      unitCost: 2,
      labor: 0,
      failureMargin: 0,
      subtotal: 2,
      markup: 0,
      unitPrice: 2,
      quantity: 1,
      total: 2,
    },
  });
  await app.api("DELETE", `/api/printers/${printer.id}`);
  await app.api("DELETE", `/api/filament/spools/${spool.id}`);
  await app.api("DELETE", `/api/projects/${project.id}`);

  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.goto(`/quotes/${quote.id}`);
  await expect(page.getByLabel("Quote name")).toHaveValue("Lamp quote");
  await page.getByLabel("Quote name").fill("Lamp quote v2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await page.goto(`/quotes/${quote.id}`);
  await expect(page.getByLabel("Quote name")).toHaveValue("Lamp quote v2");
  expect(failures).toEqual([]);
});

type Api = Parameters<typeof seedPrinter>[0];

// One entity per module: from its list, archive, find it under Show archived, restore, delete.
const MODULES: {
  module: string;
  list: string;
  name: RegExp;
  seed: (api: Api) => Promise<unknown>;
  listView?: boolean;
}[] = [
  { module: "printers", list: "/printers", name: /Test Printer/, seed: (api) => seedPrinter(api) },
  {
    module: "maintenance",
    list: "/maintenance",
    name: /Clean nozzle/,
    seed: (api) =>
      api("POST", "/api/maintenance/types", {
        name: "Clean nozzle",
        target: "printer",
        intervalDays: 30,
      }),
  },
  { module: "filament", list: "/filament", name: /Basic/, seed: (api) => seedSpool(api) },
  {
    module: "projects",
    list: "/projects",
    name: /Lamp/,
    seed: (api) => seedProject(api, "Lamp"),
    listView: true,
  },
  {
    module: "prints",
    list: "/prints",
    name: /Benchy/,
    seed: async (api) =>
      api("POST", "/api/prints", {
        printerId: (await seedPrinter(api)).id,
        startedAt: new Date().toISOString(),
        usages: [],
        title: "Benchy",
        outcome: "success",
      }),
  },
  {
    module: "costs",
    list: "/clients",
    name: /Ana/,
    seed: (api) => api("POST", "/api/clients", { name: "Ana", mobile: "911" }),
  },
];

const named = (verb: string, name: RegExp) => new RegExp(`^${verb} .*${name.source}`);

for (const { module, list, name, seed, listView } of MODULES)
  test(`${module}: archive, restore and delete from the list`, async ({ page, app }) => {
    await seed(app.api);
    await page.goto(list);
    if (listView) await page.getByRole("button", { name: "List view" }).click();

    await page.getByRole("button", { name: named("Archive", name) }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    const del = page.getByRole("button", { name: named("Delete", name) });
    await expect(del).toHaveCount(0);

    const show = page.getByLabel("Show archived").first();
    await show.check();
    await page.getByRole("button", { name: named("Restore", name) }).click();
    await expect(page.getByRole("button", { name: named("Restore", name) })).toHaveCount(0);
    await show.uncheck();

    await del.click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(del).toHaveCount(0);
  });

test("Show archived adds archived rows to the active ones, marked", async ({ page, app }) => {
  await app.api("POST", "/api/clients", { name: "Rui", mobile: "922" });
  const ana = await app.api<{ id: string }>("POST", "/api/clients", {
    name: "Ana",
    mobile: "911",
  });
  await app.api("PATCH", `/api/clients/${ana.id}`, { archived: true });
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Ana" })).toHaveCount(0);

  await page.getByLabel("Show archived").check();
  const active = page.getByRole("row", { name: /Rui/ });
  const archived = page.getByRole("row", { name: /Ana/ });
  await expect(active.getByText("Archived", { exact: true })).toHaveCount(0);
  await expect(archived.getByText("Archived", { exact: true })).toBeVisible();

  await page.getByLabel("Show archived").uncheck();
  await expect(archived).toHaveCount(0);
  await expect(active).toBeVisible();
});

test("the projects grid and the tables without the switch mark archived rows", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const project = await seedProject(app.api, "Lamp");
  await app.api("POST", "/api/prints", {
    printerId: printer.id,
    projectId: project.id,
    startedAt: new Date().toISOString(),
    usages: [],
    title: "Benchy",
    outcome: "success",
  });
  await app.api("PATCH", `/api/projects/${project.id}`, { archived: true });
  await app.api("PATCH", `/api/printers/${printer.id}`, { archived: true });

  await page.goto("/projects");
  await page.getByLabel("Show archived").check();
  const card = page.getByRole("listitem").filter({ hasText: "Lamp" });
  await expect(card.getByText("Archived", { exact: true })).toBeVisible();

  await page.goto("/stats");
  for (const [table, name] of [
    ["Printer", /Test Printer/],
    ["Project", /Lamp/],
  ] as const) {
    const row = page.getByRole("table", { name: table }).getByRole("row", { name });
    await expect(row.getByText("Archived", { exact: true })).toBeVisible();
  }
});

test("a list with only archived rows keeps its switch", async ({ page, app }) => {
  const client = await app.api<{ id: string }>("POST", "/api/clients", {
    name: "Ana",
    mobile: "911",
  });
  await app.api("PATCH", `/api/clients/${client.id}`, { archived: true });
  await page.goto("/clients");
  await page.getByLabel("Show archived").check();
  await expect(page.getByRole("link", { name: "Ana" })).toBeVisible();
});

test("a refused delete names what uses the item, with links, and offers Archive", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const project = await seedProject(app.api, "Lamp");
  const client = await app.api<{ id: string }>("POST", "/api/clients", {
    name: "Ana",
    mobile: "911",
  });
  const order = await app.api<{ id: string }>("POST", "/api/orders", {
    projectIds: [project.id],
    clientId: client.id,
    price: 100,
  });
  await app.api("POST", "/api/prints", {
    printerId: printer.id,
    projectId: project.id,
    startedAt: new Date().toISOString(),
    usages: [],
    title: "Benchy",
    outcome: "success",
  });
  // An archived dependent still blocks, and says so.
  await app.api("PATCH", `/api/orders/${order.id}`, { archived: true });

  await page.goto(`/projects/${project.id}`);
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByRole("heading")).toContainText("is still in use");
  await expect(dialog).toContainText("1 print");
  await expect(dialog).toContainText("1 order · 1 archived");
  await expect(dialog.getByRole("link", { name: /Benchy/ })).toBeVisible();

  // Archive instead: the project stays, marked, with Restore.
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

  // Already archived, there is nothing to offer; the link leads to the row.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await dialog.getByRole("link", { name: /Benchy/ }).click();
  await expect(page).toHaveURL(/\/prints\/[^/]+$/);
  await expect(dialog).toBeHidden();
});

test("a refused archive says why", async ({ page, app }) => {
  const printer = await seedPrinter(app.api);
  const accessory = await app.api<{ id: string }>("POST", "/api/accessories", {
    name: "AMS",
    type: "Feeder",
    state: "working",
  });
  await app.api("POST", `/api/accessories/${accessory.id}/installs`, {
    printerId: printer.id,
    installedAt: new Date().toISOString(),
  });
  await page.goto(`/printers/${printer.id}`);
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Archive" }).click();
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Remove its accessories first");
});

test("the actions work by keyboard and on a phone", async ({ page, app }) => {
  await app.api("POST", "/api/clients", { name: "Ana", mobile: "911" });
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto("/clients");
  expect(await hasHorizontalScroll(page)).toBe(false);

  const del = page.getByRole("button", { name: "Delete Ana" });
  const dialog = page.getByRole("dialog");
  await del.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  expect(await hasHorizontalScroll(page)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await del.focus();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Delete" }).focus();
  await page.keyboard.press("Enter");
  await expect(del).toHaveCount(0);
});

test("bulk: select by keyboard, archive, restore, and a partial delete says why", async ({
  page,
  app,
}) => {
  const ana = await app.api<{ id: string }>("POST", "/api/clients", { name: "Ana", mobile: "911" });
  await app.api("POST", "/api/clients", { name: "Bea", mobile: "912" });
  await app.api("POST", "/api/clients", { name: "Cid", mobile: "913" });
  const project = await seedProject(app.api, "Lamp");
  await app.api("POST", "/api/orders", {
    projectIds: [project.id],
    clientId: ana.id,
    price: 100,
  });
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto("/clients");

  const box = (name: string) => page.getByRole("checkbox", { name: `Select ${name}` });
  const link = (name: string) => page.getByRole("link", { name, exact: true });
  const dialog = page.getByRole("dialog");
  await expect(page.getByRole("button", { name: /^Archive \d/ })).toHaveCount(0);

  // Archive one by keyboard: the bar counts it, and it stays reachable on a phone.
  await box("Cid").focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("1 selected")).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
  await page.getByRole("button", { name: "Archive 1" }).click();
  await expect(dialog).toContainText("Archive 1 item?");
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(link("Cid")).toHaveCount(0);
  await expect(page.getByText("1 selected")).toHaveCount(0);

  // Select all, with an archived row in it: Archive and Restore count only theirs.
  await page.getByRole("checkbox", { name: "Show archived" }).check();
  await expect(link("Cid")).toBeVisible();
  await page.getByRole("checkbox", { name: SELECT_ALL }).click();
  await expect(page.getByText("3 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive 2" })).toBeVisible();
  await page.getByRole("button", { name: "Restore 1" }).click();
  await dialog.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("selected", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archive Cid" })).toBeVisible();

  // Changing the list ends a selection.
  await box("Bea").check();
  await page.getByRole("checkbox", { name: "Show archived" }).uncheck();
  await expect(page.getByText("1 selected")).toHaveCount(0);

  // Delete: the free ones go, the used one is named with what uses it and stays selected.
  await page.getByRole("checkbox", { name: SELECT_ALL }).click();
  await page.getByRole("button", { name: "Delete 3" }).click();
  await expect(dialog).toContainText("Delete 3 items?");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toContainText("Deleted 2 of 3");
  await expect(dialog).toContainText("Ana");
  await expect(dialog.getByRole("link", { name: /001/ })).toBeVisible();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(link("Bea")).toHaveCount(0);
  await expect(link("Ana")).toBeVisible();
  await expect(box("Ana")).toBeChecked();
  await expect(page.getByText("1 selected")).toBeVisible();
});

test("restore works right after archive on a project's page", async ({ page, app }) => {
  const project = await seedProject(app.api, "Lamp");
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  await expect(page.getByText("Archived", { exact: true })).toHaveCount(0);
});

test("archived printers and accessories are marked where they show", async ({ page, app }) => {
  const printer = await seedPrinter(app.api);
  const accessory = await app.api<{ id: string }>("POST", "/api/accessories", {
    name: "AMS",
    type: "Feeder",
    state: "working",
  });
  const print = await app.api<{ id: string }>("POST", "/api/prints", {
    printerId: printer.id,
    startedAt: new Date().toISOString(),
    usages: [],
    title: "Benchy",
    outcome: "success",
  });
  await app.api("POST", `/api/accessories/${accessory.id}/installs`, {
    printerId: printer.id,
    installedAt: "2026-01-01T00:00:00.000Z",
    removedAt: "2026-01-02T00:00:00.000Z",
  });
  const type = await app.api<{ id: string }>("POST", "/api/maintenance/types", {
    name: "Clean nozzle",
    intervalDays: 10,
    appliesToPrinterIds: [printer.id],
  });
  await app.api("PATCH", `/api/printers/${printer.id}`, { archived: true });
  await app.api("PATCH", `/api/accessories/${accessory.id}`, { archived: true });
  const badge = (scope: Page | Locator) => scope.getByText("Archived", { exact: true });

  // A print's printer: in the table, and on the print's page.
  await page.goto("/prints");
  const row = page.getByRole("row", { name: /Benchy/ });
  await expect(row).toContainText("Test Printer");
  await expect(badge(row)).toBeVisible();
  await page.goto(`/prints/${print.id}`);
  await expect(badge(page)).toBeVisible();

  // Their own rows under Show archived, and their pages.
  await page.goto("/printers?archived=all&accessories.archived=all");
  await expect(badge(page.getByRole("row", { name: /Test Printer/ }))).toBeVisible();
  await expect(badge(page.getByRole("row", { name: /AMS/ }))).toBeVisible();
  await page.goto(`/printers/${printer.id}`);
  await expect(badge(page.locator("header"))).toBeVisible();
  await page.goto(`/printers/accessories/${accessory.id}`);
  await expect(badge(page.locator("header"))).toBeVisible();
  // Its install history names the archived printer.
  await expect(badge(page.getByRole("listitem").filter({ hasText: "Test Printer" }))).toBeVisible();

  // A maintenance type limited to it doesn't read as "all models".
  await page.goto(`/maintenance/types/${type.id}`);
  await expect(page.getByText(/Test Printer \(archived\)/)).toBeVisible();
});

test("select all takes every row the filters list, on every page, past 100", async ({
  page,
  app,
}) => {
  for (let i = 0; i < 120; i++)
    await app.api("POST", "/api/clients", { name: `Ana ${i}`, mobile: `91${i}` });
  for (let i = 0; i < 5; i++)
    await app.api("POST", "/api/clients", { name: `Bea ${i}`, mobile: `92${i}` });
  await page.goto("/clients");
  const all = page.getByRole("checkbox", { name: SELECT_ALL });
  const bar = page.getByText(/\d selected/);

  // Everything, though a page shows 25.
  await all.focus();
  await page.keyboard.press("Space");
  await expect(bar).toHaveText("125 selected");
  await expect(all).toBeChecked();

  // It holds across pages and sorting; a row unticked anywhere is left out.
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("26–50 of 125")).toBeVisible();
  await expect(bar).toHaveText("125 selected");
  const row = page.getByRole("checkbox", { name: /^Select / }).nth(1);
  await expect(row).toBeChecked();
  await row.uncheck();
  await expect(bar).toHaveText("124 selected");
  await expect(all).not.toBeChecked();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(bar).toHaveCount(0);

  // A filter narrows it to what the filter lists.
  await page.goto("/clients?name=Bea");
  await expect(page.getByText("1–5 of 5")).toBeVisible();
  await all.click();
  await expect(bar).toHaveText("5 selected");
  await page.getByRole("button", { name: "Archive 5" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
  await expect(bar).toHaveCount(0);
  expect(
    (await app.api<{ total: number }>("GET", "/api/clients?archived=true&pageSize=1")).total,
  ).toBe(5);
  expect((await app.api<{ total: number }>("GET", "/api/clients?pageSize=1")).total).toBe(120);

  // It acts on rows it never showed: all 120 go from page 5.
  await page.goto("/clients?page=5");
  await all.click();
  await expect(bar).toHaveText("120 selected");
  await page.getByRole("button", { name: "Delete 120" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete 120 items?");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(bar).toHaveCount(0);
  expect((await app.api<{ total: number }>("GET", "/api/clients?pageSize=1")).total).toBe(0);
});

test("select all on a detail page keeps to that page's rows", async ({ page, app }) => {
  const client = (name: string, mobile: string) =>
    app.api<{ id: string }>("POST", "/api/clients", { name, mobile });
  const [ana, bea] = [await client("Ana", "911"), await client("Bea", "912")];
  const project = await seedProject(app.api, "Lamp");
  const other = await seedProject(app.api, "Vase");
  const printer = await seedPrinter(app.api);
  const projectIds = [project.id];
  for (const clientId of [ana.id, ana.id, bea.id])
    await app.api("POST", "/api/orders", { projectIds, clientId, price: 1 });
  const print = (title: string, projectId: string) =>
    app.api("POST", "/api/prints", {
      printerId: printer.id,
      title,
      projectId,
      startedAt: "2026-01-01T10:00:00.000Z",
      outcome: "success",
      usages: [],
    });
  await print("One", project.id);
  await print("Two", project.id);
  await print("Elsewhere", other.id);
  const bar = page.getByText(/\d selected/);

  await page.goto(`/clients/${ana.id}`);
  const orders = page.getByRole("table", { name: "Orders" });
  await orders.getByRole("checkbox", { name: SELECT_ALL }).click();
  await expect(bar).toHaveText("2 selected");

  await page.goto(`/projects/${project.id}`);
  await page.getByRole("heading", { name: "Prints", exact: true }).click();
  const prints = page.getByRole("table", { name: "Prints" });
  await prints.getByRole("checkbox", { name: SELECT_ALL }).click();
  await expect(bar).toHaveText("2 selected");
});

test("select all selects nothing when the list no longer matches the table", async ({
  page,
  app,
}) => {
  await app.api("POST", "/api/clients", { name: "Ana", mobile: "911" });
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Ana" })).toBeVisible();
  await app.api("POST", "/api/clients", { name: "Bea", mobile: "912" });

  const all = page.getByRole("checkbox", { name: SELECT_ALL });
  const bar = page.getByText(/\d selected/);
  await all.click();
  await expect(page.getByRole("alert")).toContainText("Couldn't select them all");
  await expect(bar).toHaveCount(0);

  // The table caught up, so trying again works.
  await expect(page.getByRole("link", { name: "Bea" })).toBeVisible();
  await all.click();
  await expect(bar).toHaveText("2 selected");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
