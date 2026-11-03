import { expect, test } from "./fixtures.ts";
import { seedModel, seedPrinter, seedProject, seedSpool } from "./helpers.ts";

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
    filaments: [spool.profileId],
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
