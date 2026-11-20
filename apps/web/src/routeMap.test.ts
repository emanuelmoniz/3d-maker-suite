import {
  BUILT_IN_RIGHTS,
  type EffectiveRights,
  WIKI_ROUTES,
  wikiTarget,
} from "@3d-maker-suite/core";
import { expect, it, vi } from "vitest";
import { guards, type RouteAccess, verdict } from "./lib/routeAccess.ts";
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

type Route = { id: string; fullPath: string; options: { staticData?: { access?: RouteAccess } } };
// The page header's Help icon reads the route map (packages/core/src/wikiRoutes.ts), so every page
// needs its entry, and an entry for an address the app doesn't have is a stale one.
const DEV_ONLY = ["/design"];
const pageRoutes = (Object.values(router.routesById) as Route[]).filter(
  (r) => "component" in r.options && !DEV_ONLY.includes(r.fullPath),
);
const pages = pageRoutes.map((r) => r.fullPath);
const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

it("every page of the app has a guide section", () => {
  expect(pages.length).toBeGreaterThan(50);
  expect(pages.filter((p) => !wikiTarget(p))).toEqual([]);
});

it("every address in the route map is a page of the app", () => {
  const known = new Set(pages.map(trim));
  expect(Object.keys(WIKI_ROUTES).filter((r) => !known.has(r))).toEqual([]);
});

// 6.2.0 Step 3f: each page states the right it needs; shell/RouteGuard.tsx enforces it.
const accessOf = (r: Route) => r.options.staticData?.access;

it("every page declares the right it needs", () => {
  // The root route is the shell around every page, not a page.
  const undeclared = pageRoutes.filter((r) => r.id !== "__root__" && !accessOf(r));
  expect(undeclared.map((r) => r.fullPath)).toEqual([]);
});

/** Forms and admin areas: an add or edit form, a settings page, users, roles, accounts, folders. */
const guarded = (p: string) =>
  /\/(new|edit)$/.test(trim(p)) ||
  /^\/(settings\/.+|users\/|integrations\/|import\/|[a-z]+\/settings)/.test(p);
const forms = pageRoutes.filter((r) => guarded(r.fullPath));

it("every form and admin page needs more than a session", () => {
  expect(forms.length).toBeGreaterThan(30);
  const loose = forms.filter((r) => {
    const a = accessOf(r);
    return !a || !guards(a.need);
  });
  expect(loose.map((r) => r.fullPath)).toEqual([]);
});

const viewer: EffectiveRights = { admin: false, ...BUILT_IN_RIGHTS.viewer };
const admin: EffectiveRights = { admin: true, ...BUILT_IN_RIGHTS.admin };
// A Viewer has no settings and no Sources task (no sync or review right, no machine of their own).
const noCfg = { settings: false, sources: false };

it("a Viewer opens no form or admin page", () => {
  const opened = forms.filter((r) => {
    const a = accessOf(r);
    return a && verdict(a, { rights: viewer, cfg: noCfg }) === "allow";
  });
  expect(opened.map((r) => r.fullPath)).toEqual([]);
});

it("an Admin opens every page", () => {
  const all = { settings: true, sources: true };
  const denied = pageRoutes.filter((r) => {
    const a = accessOf(r);
    return a && verdict(a, { rights: admin, cfg: all }) !== "allow";
  });
  expect(denied.map((r) => r.fullPath)).toEqual([]);
});

it("every page a denied person is sent to exists", () => {
  const known = new Set(pages.map(trim));
  const targets = pageRoutes.flatMap((r) => (accessOf(r)?.otherwise ?? []).map((o) => o.to));
  expect(targets.filter((to) => !known.has(to))).toEqual([]);
});
