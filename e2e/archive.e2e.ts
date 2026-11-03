import { expect, test } from "./fixtures.ts";
import { seedModel, seedPrinter, seedProject } from "./helpers.ts";

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
