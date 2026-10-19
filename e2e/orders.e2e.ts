import { expect, test } from "./fixtures.ts";
import { pick, seedPrinter, seedProject } from "./helpers.ts";

test("orders: create, statuses, prints from both sides, project and client pages", async ({
  page,
  app,
}) => {
  const printer = await seedPrinter(app.api);
  const lamp = await seedProject(app.api, "Lamp");
  const vase = await seedProject(app.api, "Vase");
  await app.api("POST", "/api/clients", { name: "Ana", mobile: "911" });
  const base = {
    printerId: printer.id,
    startedAt: new Date().toISOString(),
    durationSec: 3600,
    outcome: "success",
    usages: [],
  };
  await app.api("POST", "/api/prints", { ...base, title: "Shade", projectId: lamp.id });
  const vasePrint = await app.api<{ id: string }>("POST", "/api/prints", {
    ...base,
    title: "Body",
    projectId: vase.id,
  });

  // Create: a project is needed before it saves.
  await page.goto("/orders/new");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await pick(page.getByLabel("Client"), "Ana");
  await pick(page.getByLabel("Projects"), "001-Lamp");
  await page.getByLabel("Price").fill("120");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Order 001" })).toBeVisible();

  // Statuses move from the order page.
  await pick(page.getByLabel("Status"), "In progress");
  await page.reload();
  await expect(page.getByLabel("Status")).toHaveValue("In progress");

  // A print of its project, from the order page; its cost shows next to the price.
  await pick(page.getByLabel("A print of this order's projects"), "0001-Shade");
  await page.getByRole("button", { name: "Add print" }).click();
  const prints = page.getByRole("table", { name: "Prints" });
  await expect(prints.getByRole("link", { name: "0001-Shade" })).toBeVisible();
  await expect(page.getByText("Cost of 1 print")).toBeVisible();

  // A print of another project, from the print form: that project joins the order.
  await page.goto(`/prints/${vasePrint.id}/edit`);
  await pick(page.getByLabel("Order", { exact: true }), "Order 001");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Order 001" })).toBeVisible();
  await page.getByRole("link", { name: "Order 001" }).click();
  await expect(page.getByRole("link", { name: "002-Vase" }).first()).toBeVisible();
  await expect(page.getByText("Cost of 2 prints")).toBeVisible();

  // Its last print leaves: the project can go too.
  await page.getByRole("button", { name: "Remove 0002-Body from the order" }).click();
  await expect(page.getByRole("heading", { name: "Remove the project too?" })).toBeVisible();
  await page.getByRole("button", { name: "Remove project" }).click();
  await expect(page.getByText("Cost of 1 print")).toBeVisible();
  await expect(page.locator("dl").getByRole("link", { name: "002-Vase" })).toHaveCount(0);

  // Listed on its project's and its client's pages.
  await page.goto(`/projects/${lamp.id}`);
  await expect(
    page.getByRole("table", { name: "Orders" }).getByRole("link", { name: "001", exact: true }),
  ).toBeVisible();
  await page.getByRole("table", { name: "Orders" }).getByRole("link", { name: "Ana" }).click();
  await expect(page.getByRole("heading", { name: "Ana" })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Orders" }).getByRole("link", { name: "001", exact: true }),
  ).toBeVisible();
});

test("orders: statuses come from the orders settings", async ({ page, app }) => {
  const project = await seedProject(app.api, "Lamp");
  const order = await app.api<{ id: string }>("POST", "/api/orders", {
    projectIds: [project.id],
    price: 1000,
  });
  await page.goto("/orders/settings");
  await page.getByLabel("Order statuses").fill("quoted\nprinting\nshipped");
  await page.getByLabel("Order statuses").blur();
  await expect(page.getByLabel("Order statuses")).toHaveValue("quoted\nprinting\nshipped");

  await page.goto(`/orders/${order.id}`);
  await pick(page.getByLabel("Status"), "shipped");
  await page.reload();
  await expect(page.getByLabel("Status")).toHaveValue("shipped");
});

test("orders: create order from a quote fills client, project and price", async ({ page, app }) => {
  const project = await seedProject(app.api, "Lamp");
  const client = await app.api<{ id: string }>("POST", "/api/clients", {
    name: "Ana",
    mobile: "911",
  });
  const q = await app.api<{ id: string }>("POST", "/api/costs/quotes", {
    name: "Lamp",
    projectId: project.id,
    clientId: client.id,
    form: { minutes: 60, filaments: [], quantity: 1 },
    cost: { material: 0, energy: 0, wear: 0, maintenance: 0, total: 0, unpricedGrams: 0 },
    quote: {
      unitCost: 0,
      labor: 0,
      failureMargin: 0,
      subtotal: 0,
      markup: 0,
      unitPrice: 12345,
      quantity: 1,
      total: 12345,
    },
  });

  await page.goto(`/quotes/${q.id}`);
  await page.getByRole("link", { name: "Create order" }).click();
  await expect(page.getByLabel("Quote")).toHaveValue("001-Lamp");
  await expect(page.getByLabel("Client")).toHaveValue("Ana");
  await expect(page.getByRole("listitem").filter({ hasText: "001-Lamp" })).toBeVisible();
  await expect(page.getByLabel("Price")).toHaveValue("123.45");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Order 001" })).toBeVisible();
  await expect(page.locator("dl").getByRole("link", { name: "001-Lamp" })).toHaveCount(2);
});
