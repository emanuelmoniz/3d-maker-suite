import type { Locator, Page } from "@playwright/test";

type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

/** The "Acme X1" printer model, created on first use. */
export const seedModel = async (api: Api) => {
  const found = await api<{ items: { id: string }[] }>(
    "GET",
    "/api/printer-models?model=Acme%20X1",
  );
  if (found.items[0]) return found.items[0];
  const brand = await api<{ id: string }>("POST", "/api/brands", { name: "Acme" });
  return api<{ id: string }>("POST", "/api/printer-models", { brandId: brand.id, model: "X1" });
};

export const seedPrinter = async (api: Api, name = "Test Printer") =>
  api<{ id: string }>("POST", "/api/printers", {
    name,
    modelId: (await seedModel(api)).id,
    state: "working",
  });

/** A project without a folder; a new print has to pick one. */
export const seedProject = (api: Api, name = "Test Project") =>
  api<{ id: string }>("POST", "/api/projects", { name });

/** The "Acme PLA Basic" filament profile with its brand and material. Once per test. */
export const seedProfile = async (api: Api) => {
  const brand = await api<{ id: string }>("POST", "/api/filament-brands", { name: "Acme" });
  const material = await api<{ id: string }>("POST", "/api/filament-materials", { name: "PLA" });
  return api<{ id: string }>("POST", "/api/filament/profiles", {
    brandId: brand.id,
    materialId: material.id,
    densityGcm3: 1.24,
    name: "Basic",
  });
};

export const seedSpool = async (api: Api, grams = 1000) => {
  const profile = await seedProfile(api);
  return api<{ id: string }>("POST", "/api/filament/spools", {
    profileId: profile.id,
    colorHex: "#ff0000",
    initialGrams: grams,
  });
};

/** Pages that must not scroll sideways at any viewport. */
export const ROUTES = [
  "/",
  "/printers",
  "/printers/new",
  "/printers/models/new",
  "/printers/accessories/new",
  "/maintenance",
  "/filament",
  "/filament/spools/new",
  "/prints",
  "/prints/new",
  "/projects",
  "/quotes",
  "/quotes/new",
  "/orders",
  "/orders/new",
  "/orders/settings",
  "/stats",
  "/alerts",
  "/quotes/settings",
  "/prints/settings",
  "/projects/settings",
  "/alerts/settings",
  "/printers/settings",
  "/filament/settings",
  "/import",
  "/settings",
  "/integrations",
];

/** Picks an option in a Combobox: by its exact label, or by position (0 is the first option). */
export const pick = async (combo: Locator, option: string | number) => {
  await combo.click();
  const options = combo.page().getByRole("option");
  await (typeof option === "number"
    ? options.nth(option)
    : options.getByText(option, { exact: true })
  ).click();
};

export const hasHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
