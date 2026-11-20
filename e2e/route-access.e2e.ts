import { dirname } from "node:path";
import type { Page } from "@playwright/test";
import { testTimeout } from "../test-timeout.ts";
import { expect, test } from "./fixtures.ts";
import { addRoots, seedModel, seedPrinter, seedProject, seedSpool } from "./helpers.ts";

// 6.2.0 Step 3f: every page checks the right it needs. A Viewer who opens a form by its address
// lands on the item or its list with "Your role can't change this."; an admin area says "You can't
// open this"; a missing or hidden item says the same neutral text.
const PASSWORD = "correct horse";
const VIEWER = "00000000-0000-4000-8000-000000000003"; // the seeded role (migration 0086)
const UNKNOWN = "00000000-0000-4000-8000-0000000000ff";

const post = async (page: Page, path: string, data: unknown) => {
  const res = await page.request.post(path, { data });
  expect(res.ok(), `${path} ${res.status()}`).toBe(true);
  return (await res.json()) as { id: string };
};

test("a viewer gets no form: each address lands on its item, or says it can't open", async ({
  page,
  app,
}) => {
  test.setTimeout(testTimeout(120_000));
  await page.setViewportSize({ width: 1280, height: 900 });

  // One of each, made while the app has no accounts yet (everyone is Admin then).
  const printer = await seedPrinter(app.api);
  const model = await seedModel(app.api);
  const brand = (await app.api<{ items: { id: string }[] }>("GET", "/api/brands")).items[0];
  const accessory = await app.api<{ id: string }>("POST", "/api/accessories", {
    name: "AMS",
    type: "Feeder",
    state: "working",
  });
  const type = await app.api<{ id: string }>("POST", "/api/maintenance/types", {
    name: "Clean nozzle",
    intervalDays: 10,
    warnLeadDays: 5,
  });
  const spool = await seedSpool(app.api);
  // The spool's brand and material.
  const filament = await app.api<{ brandId: string; materialId: string }>(
    "GET",
    `/api/filament/spools/${spool.id}`,
  );
  const project = await seedProject(app.api);
  const print = await app.api<{ id: string }>("POST", "/api/prints", {
    title: "Benchy",
    printerId: printer.id,
    startedAt: new Date().toISOString(),
    durationSec: 3600,
    outcome: "success",
    usages: [],
  });
  const client = await app.api<{ id: string }>("POST", "/api/clients", {
    name: "Acme",
    mobile: "911",
  });
  const order = await app.api<{ id: string }>("POST", "/api/orders", {
    projectIds: [project.id],
    clientId: client.id,
    price: 100,
  });
  const integration = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await addRoots(app.api, dirname(app.makeProjectDir("Dragon")));
  const root = (await app.api<{ id: string }[]>("GET", "/api/roots"))[0];

  // The admin and the viewer.
  await page.goto("/");
  await post(page, "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  const vic = await post(page, "/api/users", {
    displayName: "Vic Viewer",
    email: "vic@example.com",
    password: PASSWORD,
    roleId: VIEWER,
  });
  await page.context().clearCookies();
  await post(page, "/api/auth/login", { email: "vic@example.com", password: PASSWORD });

  const notice = page.getByRole("alert").filter({ hasText: "Your role can't change this." });
  const forms: [from: string, to: string][] = [
    ["/printers/new", "/printers"],
    [`/printers/${printer.id}/edit`, `/printers/${printer.id}`],
    ["/printers/accessories/new", "/printers/accessories"],
    [`/printers/accessories/${accessory.id}/edit`, `/printers/accessories/${accessory.id}`],
    ["/printers/brands/new", "/catalog/printers"],
    [`/printers/brands/${brand?.id}/edit`, "/catalog/printers"],
    ["/printers/models/new", "/catalog/printers"],
    [`/printers/models/${model.id}/edit`, "/catalog/printers"],
    ["/maintenance/new", "/printers/maintenance"],
    [`/maintenance/types/${type.id}/edit`, `/maintenance/types/${type.id}`],
    ["/filament/spools/new", "/filament"],
    [`/filament/spools/${spool.id}/edit`, `/filament/spools/${spool.id}`],
    ["/filament/brands/new", "/catalog/filament"],
    [`/filament/brands/${filament.brandId}/edit`, "/catalog/filament"],
    ["/filament/materials/new", "/catalog/filament"],
    [`/filament/materials/${filament.materialId}/edit`, "/catalog/filament"],
    ["/prints/new", "/prints"],
    [`/prints/${print.id}/edit`, `/prints/${print.id}`],
    ["/projects/new", "/projects"],
    [`/projects/${project.id}/edit`, `/projects/${project.id}`],
    ["/projects/settings/folders/new", "/projects"],
    [`/projects/settings/folders/${root?.id}`, "/projects"],
    ["/quotes/new", "/quotes"],
    ["/orders/new", "/orders"],
    [`/orders/${order.id}/edit`, `/orders/${order.id}`],
    ["/clients/new", "/clients"],
    [`/clients/${client.id}/edit`, `/clients/${client.id}`],
    ["/printers/settings", "/printers"],
    ["/prints/settings/sources", "/prints"],
    ["/alerts/settings", "/alerts"],
  ];
  for (const [from, to] of forms) {
    await page.goto(from);
    // A list may add its default filters to the address.
    await expect(page, from).toHaveURL((url) => url.pathname === to);
    await expect(notice, from).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save/ }), from).toHaveCount(0);
  }

  // Admin areas: nothing to read there either.
  for (const path of [
    "/integrations/new",
    `/integrations/${integration.id}/edit`,
    "/users/roles/new",
    `/users/roles/${VIEWER}`,
    `/users/${vic.id}`,
    "/hub/settings",
    "/logs/settings",
    "/import/slicer-zip",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "You can't open this" }), path).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save/ }), path).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Go to the dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);

  // Missing and hidden items read the same.
  for (const path of [`/alerts/${UNKNOWN}`, `/hub/devices/${UNKNOWN}`, `/printers/${UNKNOWN}`]) {
    await page.goto(path);
    await expect(page.getByText("This doesn't exist, or you can't open it."), path).toBeVisible();
  }

  // The order page reads; its status and prints don't change.
  await page.goto(`/orders/${order.id}`);
  await expect(page.getByRole("heading", { name: /^Order / })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add print" })).toHaveCount(0);
});

test("a viewer reads a saved quote without its save controls", async ({ page, app }) => {
  const project = await seedProject(app.api);
  const printer = await seedPrinter(app.api);
  const quote = await app.api<{ id: string }>("POST", "/api/costs/quotes", {
    name: "Lamp quote",
    form: { projectId: project.id, printerId: printer.id, plates: [] },
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
  await page.goto("/");
  await post(page, "/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: PASSWORD,
  });
  await post(page, "/api/users", {
    displayName: "Vic Viewer",
    email: "vic@example.com",
    password: PASSWORD,
    roleId: VIEWER,
  });
  await page.context().clearCookies();
  await post(page, "/api/auth/login", { email: "vic@example.com", password: PASSWORD });

  const refused: string[] = [];
  page.on("response", (r) => r.status() === 403 && refused.push(r.url()));
  await page.goto(`/quotes/${quote.id}`);
  await expect(page.getByRole("heading", { name: /Lamp quote/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  for (const name of ["Save changes", "Save as new", "Slice"])
    await expect(page.getByRole("button", { name }), name).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create order" })).toHaveCount(0);
  await expect(page.getByText("Add .3mf files", { exact: true })).toHaveCount(0);
  expect(refused).toEqual([]);
});
