import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";

type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

/** `projectRoots` preference value: each path with the default settings (as `projectRoot` in core). */
export const roots = (...paths: string[]) =>
  paths.map((path) => ({ path, projectDepth: 1, filesDepth: null, autoSlice: true }));

/** Opens every integration card on the page (they start closed). */
export async function openIntegrationCards(page: Page) {
  const closed = page.getByRole("heading", { level: 3 }).getByRole("button", { expanded: false });
  await closed.first().waitFor();
  while (await closed.count()) await closed.first().click();
}

/** The Integrations page with every card open. */
export async function gotoIntegrations(page: Page) {
  await page.goto("/integrations");
  await openIntegrationCards(page);
}

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
  // The open listbox's options, not those of native selects on the page.
  const options = combo.page().getByRole("listbox").getByRole("option");
  await (typeof option === "number"
    ? options.nth(option)
    : options.getByText(option, { exact: true })
  ).click();
};

export const hasHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** Visible controls that hang off the right edge (outside anything that scrolls on its own). */
export const offScreen = (page: Page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrolls = (el: Element | null) => {
      for (; el && el !== document.body; el = el.parentElement) {
        const o = getComputedStyle(el).overflowX;
        if ((o === "auto" || o === "scroll") && el.scrollWidth > el.clientWidth) return true;
      }
      return false;
    };
    return [
      ...document.querySelectorAll<HTMLElement>(
        "a[href], button, input:not([type=hidden]), [role=combobox]",
      ),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1 && !el.closest(".sr-only") && !scrolls(el);
      })
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`,
      );
  });

/** Opens the collapsible cards of the project edit page (they start closed). */
export const openSections = async (page: Page, ...names: string[]) => {
  for (const name of names) await page.getByRole("heading", { name, exact: true }).click();
};

/** A w×h gradient PNG, so the gallery has something to show. */
export const png = (hue: number) => {
  const [w, h] = [320, 240];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (hue + x) % 256;
      raw[o + 1] = (hue * 2 + y) % 256;
      raw[o + 2] = (hue * 3 + x + y) % 256;
    }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    let c = ~0;
    for (const b of out.subarray(4, 8 + data.length)) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    out.writeInt32BE(~c, 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** A project with a long name, 8 gallery images and a description that stresses the layout: a 200-char URL, a table and a code block. */
export const seedRichProject = async (api: Api, dataDir: string) => {
  const root = join(dataDir, "models");
  const dir = join(root, "Rich");
  mkdirSync(dir, { recursive: true });
  const images = Array.from({ length: 8 }, (_, i) => `image-${i + 1}.png`);
  for (const [i, n] of images.entries()) writeFileSync(join(dir, n), png(30 * i + 20));
  await api("PATCH", "/api/preferences", { projectRoots: roots(root) });
  const project = await api<{ id: string }>("POST", "/api/projects", {
    name: "A project with a very long name that keeps going and going until it cannot fit a phone",
    folderPath: dir,
  });
  const description = [
    `https://example.com/${"long-path-segment/".repeat(12)}`,
    "",
    "| Part | Material | Weight | Print time | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| Body | PLA | 120 g | 4 h | A long note that needs room to breathe on a narrow screen |",
    "",
    "```",
    `const line = "${"x".repeat(120)}";`,
    "```",
  ].join("\n");
  await api("PATCH", `/api/projects/${project.id}`, {
    description,
    gallery: { folders: [], images },
  });
  return project;
};
