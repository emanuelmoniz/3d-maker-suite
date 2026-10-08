import type { Page } from "@playwright/test";

type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

export const seedPrinter = (api: Api, name = "Test Printer") =>
  api<{ id: string }>("POST", "/api/printers", {
    name,
    brand: "Acme",
    model: "X1",
    state: "working",
  });

export const seedSpool = async (api: Api, grams = 1000) => {
  const profile = await api<{ id: string }>("POST", "/api/filament/profiles", {
    brand: "Acme",
    material: "PLA",
    densityGcm3: 1.24,
    name: "Basic",
  });
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
  "/maintenance",
  "/filament",
  "/filament/spools/new",
  "/prints",
  "/prints/new",
  "/projects",
  "/costs",
  "/stats",
  "/alerts",
  "/settings",
  "/settings/integrations",
];

export const hasHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
