import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../e2e/fixtures.ts";
import { addRoots, png, seedPrinter, seedProfile } from "../e2e/helpers.ts";

const IMAGES = "docs/images";

test("README screenshots", async ({ page, app }) => {
  test.setTimeout(180_000);
  const type = await app.api<{ id: string }>("POST", "/api/maintenance/types", {
    name: "Clean nozzle",
    intervalDays: 10,
    warnLeadDays: 10,
  });
  const profile = await seedProfile(app.api);
  const spools: { id: string }[] = [];
  for (const [colorHex, colorName] of [
    ["#e53935", "Red"],
    ["#1e88e5", "Blue"],
    ["#43a047", "Green"],
  ]) {
    spools.push(
      await app.api<{ id: string }>("POST", "/api/filament/spools", {
        profileId: profile.id,
        colorHex,
        colorName,
        initialGrams: 1000,
        pricePaid: 2000,
      }),
    );
  }

  // Dragon is the fully set up project: a 3MF with a sliced plate, gallery images and prints.
  const root = join(app.dataDir, "models");
  const dragonDir = join(root, "Dragon");
  mkdirSync(dragonDir, { recursive: true });
  copyFileSync(
    join(import.meta.dirname, "../packages/3mf/fixtures/multi_color.3mf"),
    join(dragonDir, "dragon.3mf"),
  );
  const images = ["front.png", "side.png", "top.png"];
  for (const [i, n] of images.entries()) writeFileSync(join(dragonDir, n), png(60 * i + 20));
  await addRoots(app.api, root);
  const dragon = await app.api<{ id: string; meta: { models: { plates: { index: number }[] }[] } }>(
    "POST",
    "/api/projects",
    { name: "Dragon", folderPath: dragonDir },
  );
  const mock = await app.api<{ id: string }>("POST", "/api/integrations", {
    adapterId: "mock",
    secrets: { token: "t" },
  });
  await app.api("PATCH", `/api/integrations/${mock.id}`, { slicerPath: process.execPath });
  await app.api("POST", "/api/integrations", { adapterId: "bambu-studio-server" });
  await app.api("PUT", `/api/projects/${dragon.id}/slicing`, {
    plates: [
      {
        file: "dragon.3mf",
        plate: dragon.meta.models[0]?.plates[0]?.index ?? 1,
        printerId: null, // no printer exists yet, so the file's own profile is used
        printProfileId: null,
        useDefaultPrintProfile: false,
        filaments: [],
        spools: [spools[0]?.id ?? null],
      },
    ],
  });
  await app.api("POST", `/api/projects/${dragon.id}/slicing/run`);
  await expect
    .poll(async () => {
      const s = await app.api<{ plates: { result: unknown }[] }>(
        "GET",
        `/api/projects/${dragon.id}/slicing`,
      );
      return s.plates.every((p) => p.result);
    })
    .toBe(true);
  await app.api("PATCH", `/api/projects/${dragon.id}`, {
    description: "A dragon that guards the desk. Printed in three colours, no supports.",
    gallery: { folders: [], images },
  });

  // Created after the slicing above: slicing falls back to the first printer, which has no preset.
  const printer = await seedPrinter(app.api, "Workshop X1");
  await seedPrinter(app.api, "Desk Mini");
  const ams = await app.api<{ id: string }>("POST", "/api/accessories", {
    name: "AMS",
    type: "AMS",
  });
  await app.api("POST", `/api/accessories/${ams.id}/installs`, {
    printerId: printer.id,
    installedAt: new Date().toISOString(),
  });
  await app.api("POST", "/api/accessories", { name: "Spare hotend 0.6", type: "Hotend" });

  const others = [
    await app.api<{ id: string }>("POST", "/api/projects", { name: "Desk organizer" }),
    await app.api<{ id: string }>("POST", "/api/projects", { name: "Planter" }),
  ];
  const projects = [dragon, ...others];
  const day = 86_400_000;
  let lastPrint = "";
  for (let i = 0; i < 18; i++) {
    const p = await app.api<{ id: string }>("POST", "/api/prints", {
      printerId: printer.id,
      projectId: projects[i % 3]?.id,
      title: `${["Dragon body", "Organizer tray", "Planter pot"][i % 3]} #${i + 1}`,
      startedAt: new Date(Date.now() - (18 - i) * day).toISOString(),
      durationSec: 3600 * (1 + (i % 5)),
      outcome: i % 7 === 6 ? "failed" : "success",
      usages: [{ spoolId: spools[i % 3]?.id, grams: 20 + ((i * 13) % 80) }],
    });
    lastPrint = p.id;
  }

  const client = await app.api<{ id: string }>("POST", "/api/clients", {
    name: "Ana Pereira",
    mobile: "911222333",
  });
  const quote = await app.api<{ id: string }>("POST", "/api/costs/quotes", {
    name: "Dragon",
    projectId: dragon.id,
    clientId: client.id,
    form: { minutes: 240, filaments: [], quantity: 1 },
    cost: { material: 300, energy: 100, wear: 100, maintenance: 100, total: 600, unpricedGrams: 0 },
    quote: {
      unitCost: 600,
      labor: 400,
      failureMargin: 100,
      subtotal: 1100,
      markup: 400,
      unitPrice: 1500,
      quantity: 1,
      total: 1500,
    },
  });
  const order = await app.api<{ id: string }>("POST", "/api/orders", {
    projectIds: [dragon.id],
    quoteId: quote.id,
    clientId: client.id,
    price: 1500,
  });
  await app.api("POST", "/api/alerts/evaluate");
  const alerts = await app.api<{ id: string }[]>("GET", "/api/alerts");
  const profileId = profile.id;

  const shots: [string, string][] = [
    ["dashboard", "/"],
    ["printers", "/printers"],
    ["printer", `/printers/${printer.id}`],
    ["accessory", `/printers/accessories/${ams.id}`],
    ["maintenance", "/maintenance"],
    ["maintenance-type", `/maintenance/types/${type.id}`],
    ["filament", "/filament"],
    ["spool", `/filament/spools/${spools[0]?.id}`],
    ["filament-profile", `/filament/profiles/${profileId}`],
    ["prints", "/prints"],
    ["print", `/prints/${lastPrint}`],
    ["projects", "/projects"],
    ["project", `/projects/${dragon.id}`],
    ["quotes", "/quotes"],
    ["quote", `/quotes/${quote.id}`],
    ["quote-new", "/quotes/new"],
    ["orders", "/orders"],
    ["order", `/orders/${order.id}`],
    ["clients", "/clients"],
    ["client", `/clients/${client.id}`],
    ["stats", "/stats"],
    ["alerts", "/alerts"],
    ...(alerts[0] ? ([["alert", `/alerts/${alerts[0].id}`]] as [string, string][]) : []),
    ["import", "/import"],
    ["settings", "/settings"],
    ["integrations", "/integrations"],
  ];
  for (const [name, path] of shots) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
    if (name === "project") await page.waitForTimeout(2000); // the 3D view fits its camera after it loads
    await page.screenshot({ path: `${IMAGES}/${name}.png`, fullPage: name === "project" });
  }

  // Accounts: the admin is created in this browser, so the users list is shown signed in.
  const password = "correct horse";
  await page.request.post("/api/auth/setup", {
    data: { email: "ana@example.com", displayName: "Ana Pereira", password },
  });
  await page.request.post("/api/users", {
    data: { email: "eva@example.com", displayName: "Eva Editor", password, role: "editor" },
  });
  await page.goto("/settings");
  await page.getByRole("heading", { name: "Users" }).scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${IMAGES}/users.png` });

  await page.context().clearCookies();
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${IMAGES}/login.png` });
});

test("hub screenshots", async ({ page, app }) => {
  test.setTimeout(180_000);
  // A hub root with locks and versions on, one paired workstation that saves a 3MF twice.
  await page.request.post("/api/auth/setup", {
    data: { displayName: "Ana Pereira", email: "ana@example.com", password: "correct horse" },
  });
  await page.request.patch("/api/preferences", {
    data: { hubEnabled: true, hubLocks: "on", hubVersions: true },
  });
  const hubDir = join(app.dataDir, "hub-models");
  mkdirSync(hubDir, { recursive: true });
  const root = await page.request
    .post("/api/roots", { data: { path: hubDir } })
    .then((r) => r.json() as Promise<{ id: string }>);
  const { user } = await page.request
    .get("/api/auth/me")
    .then((r) => r.json() as Promise<{ user: { id: string } }>);
  const { code } = await page.request
    .post("/api/hub/pairing-codes", { data: { userId: user.id } })
    .then((r) => r.json() as Promise<{ code: string }>);
  const { token } = await fetch(`${app.url}/api/hub/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: "Desk PC", os: "win32", connectorVersion: "5.0.0" }),
  }).then((r) => r.json() as Promise<{ token: string }>);
  // Online = its event stream is open, as a running connector holds it (the stream stays open).
  await fetch(`${app.url}/api/hub/events`, { headers: { authorization: `Bearer ${token}` } });
  const save = (body: Buffer, base: number) =>
    fetch(
      `${app.url}/api/hub/device/sync/roots/${root.id}/file?path=${encodeURIComponent("Vase/vase.3mf")}&base=${base}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/octet-stream",
          "x-file-sha256": createHash("sha256").update(body).digest("hex"),
        },
        body,
      },
    ).then((r) => r.json());
  const model = readFileSync(join(import.meta.dirname, "../packages/3mf/fixtures/multi_color.3mf"));
  await save(model, 0);
  await save(Buffer.concat([model, Buffer.from("\n")]), 1);
  await page.request.post("/api/projects/scan");
  await expect
    .poll(async () => (await page.request.get("/api/projects/scan")).json().then((s) => s.state))
    .toBe("idle");
  const { items } = await page.request
    .get("/api/projects")
    .then((r) => r.json() as Promise<{ items: { id: string; name: string }[] }>);
  const vase = items.find((p) => p.name === "Vase");
  if (!vase) throw new Error("the scan did not find the Vase project");

  await page.goto("/hub");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Online")).toBeVisible();
  await page.screenshot({ path: `${IMAGES}/hub.png` });

  await page.goto(`/projects/${vase.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Files", exact: true }).click();
  await expect(page.getByText("Being edited by Ana Pereira on Desk PC")).toBeVisible();
  await page.screenshot({ path: `${IMAGES}/project-hub.png`, fullPage: true });

  await page.getByRole("button", { name: "Versions of vase.3mf" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${IMAGES}/file-history.png` });
});
