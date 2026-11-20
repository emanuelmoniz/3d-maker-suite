import {
  type EffectiveRights,
  hasLevel,
  type PermissionLevel,
  type PermissionModule,
  type PermissionSwitch,
} from "@3d-maker-suite/core";
import type { SettingsModule } from "../components/SettingsLink.tsx";

/**
 * The right a page needs (6.2.0 Step 3f), named as the server's `RULES` (`apps/server/src/lib/auth.ts`).
 * Every route declares one in `staticData.access`; `shell/RouteGuard.tsx` enforces it. The server
 * still refuses on its own; this decides what the person sees.
 */
export type RouteRight =
  /** No session needed: login and setup. */
  | { kind: "public" }
  /** Anyone signed in, or everyone in the no-users mode. */
  | { kind: "session" }
  | { kind: "at"; module: PermissionModule; level: PermissionLevel }
  | { kind: "on"; permission: PermissionSwitch }
  | { kind: "either"; any: RouteRight[] }
  /**
   * A module's settings page (`useSettingsAccess`): `settings` = the whole page, `sources` = only
   * its Sources tab (an editor's sync or review task, a machine's own user; ADR-0012, ADR-0021).
   */
  | { kind: "cfg"; module: SettingsModule; access: "settings" | "sources" };

/**
 * `need` opens the page. Without it, the first `otherwise` whose `if` holds sends the person to `to`
 * (its `$params` filled from the address), with "Your role can't change this." when `notice`; none
 * left shows "You can't open this".
 */
export type RouteAccess = {
  need: RouteRight;
  otherwise?: { if: RouteRight; to: string; notice?: true }[];
};

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    access?: RouteAccess;
  }
}

export const PUBLIC: RouteRight = { kind: "public" };
export const SESSION: RouteRight = { kind: "session" };
export const at = (module: PermissionModule, level: PermissionLevel): RouteRight => ({
  kind: "at",
  module,
  level,
});
export const on = (permission: PermissionSwitch): RouteRight => ({ kind: "on", permission });
export const either = (...any: RouteRight[]): RouteRight => ({ kind: "either", any });
export const cfg = (module: SettingsModule, access: "settings" | "sources"): RouteRight => ({
  kind: "cfg",
  module,
  access,
});

/** A page that needs `need`; without it, back to `to` with the notice if `read` holds. */
export const form = (need: RouteRight, read: RouteRight, to: string): RouteAccess => ({
  need,
  otherwise: [{ if: read, to, notice: true }],
});

/** What `useSettingsAccess` found for the module a `cfg` right names. */
export type CfgAccess = { settings: boolean; sources: boolean };

export type AccessContext = { rights: EffectiveRights; cfg?: CfgAccess };

export function holds(right: RouteRight, ctx: AccessContext): boolean {
  const p = ctx.rights.permissions;
  switch (right.kind) {
    case "public":
    case "session":
      return true;
    case "at":
      return ctx.rights.admin || hasLevel(p, right.module, right.level);
    case "on":
      return ctx.rights.admin || p[right.permission];
    case "either":
      return right.any.some((r) => holds(r, ctx));
    case "cfg":
      return !!ctx.cfg?.[right.access];
  }
}

/** The settings module a declaration's rights depend on, if any (the guard loads its access). */
export function cfgModule(access: RouteAccess): SettingsModule | undefined {
  const find = (r: RouteRight): SettingsModule | undefined =>
    r.kind === "cfg" ? r.module : r.kind === "either" ? r.any.map(find).find(Boolean) : undefined;
  return [access.need, ...(access.otherwise ?? []).map((o) => o.if)].map(find).find(Boolean);
}

export type Verdict = "allow" | "cantOpen" | { to: string; notice: boolean };

export function verdict(access: RouteAccess, ctx: AccessContext): Verdict {
  if (holds(access.need, ctx)) return "allow";
  const o = access.otherwise?.find((x) => holds(x.if, ctx));
  return o ? { to: o.to, notice: !!o.notice } : "cantOpen";
}

/** Whether a right is more than "signed in": what a form or admin page must declare. */
export const guards = (right: RouteRight): boolean =>
  right.kind === "either"
    ? right.any.every(guards)
    : right.kind !== "public" && right.kind !== "session";
