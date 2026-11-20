import { WIKI_ROUTES, wikiTarget } from "@3d-maker-suite/core";
import { expect, it, vi } from "vitest";
import { router } from "./router.tsx";

// The router's pages are only loaded, not rendered; a few modules read the browser when they load.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.document ??= { documentElement: { dataset: {} } }; // lib/theme.ts applies the theme
  g.self ??= globalThis; // with a document, the router registers itself on `self`
});
// The same router, built as on a server: a memory history, no browser.
vi.mock("@tanstack/react-router", async (load) => {
  const actual = await load<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createRouter: (options: Parameters<typeof actual.createRouter>[0]) =>
      actual.createRouter({ ...options, isServer: true, history: actual.createMemoryHistory() }),
  };
});

// The page header's Help icon reads the route map (packages/core/src/wikiRoutes.ts), so every page
// needs its entry, and an entry for an address the app doesn't have is a stale one.
const DEV_ONLY = ["/design"];
const pages = (Object.values(router.routesById) as { fullPath: string; options: object }[])
  .filter((r) => "component" in r.options && !DEV_ONLY.includes(r.fullPath))
  .map((r) => r.fullPath);

it("every page of the app has a guide section", () => {
  expect(pages.length).toBeGreaterThan(50);
  expect(pages.filter((p) => !wikiTarget(p))).toEqual([]);
});

it("every address in the route map is a page of the app", () => {
  const known = new Set(pages.map((p) => (p.length > 1 ? p.replace(/\/+$/, "") : p)));
  expect(Object.keys(WIKI_ROUTES).filter((r) => !known.has(r))).toEqual([]);
});
