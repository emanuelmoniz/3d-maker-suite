import { BUILT_IN_RIGHTS, type EffectiveRights } from "@3d-maker-suite/core";
import { describe, expect, it } from "vitest";
import { at, cfg, cfgModule, either, form, guards, on, SESSION, verdict } from "./routeAccess.ts";

const role = (name: keyof typeof BUILT_IN_RIGHTS): EffectiveRights => ({
  admin: name === "admin",
  ...BUILT_IN_RIGHTS[name],
});
const viewer = role("viewer");
const editor = role("editor");
const admin = role("admin");
const printerEdit = form(at("printers", "manage"), at("printers", "read"), "/printers/$id");

describe("verdict", () => {
  it("opens a page the right allows", () => {
    expect(verdict({ need: at("printers", "read") }, { rights: viewer })).toBe("allow");
    expect(verdict(printerEdit, { rights: admin })).toBe("allow");
  });

  it("sends a reader from a form to its item, with the notice", () => {
    expect(verdict(printerEdit, { rights: viewer })).toEqual({ to: "/printers/$id", notice: true });
    // Editors write, but printers are manage's.
    expect(verdict(printerEdit, { rights: editor })).toEqual({ to: "/printers/$id", notice: true });
  });

  it("says 'can't open' without any right to the module", () => {
    const none: EffectiveRights = {
      ...viewer,
      permissions: { ...viewer.permissions, printers: "none" },
    };
    expect(verdict(printerEdit, { rights: none })).toBe("cantOpen");
    expect(verdict({ need: on("users.manage") }, { rights: editor })).toBe("cantOpen");
  });

  it("moves quietly to the tab a role reads", () => {
    const maintenanceOnly: EffectiveRights = {
      ...viewer,
      permissions: { ...viewer.permissions, printers: "none" },
    };
    const printersTab = {
      need: at("printers", "read"),
      otherwise: [{ if: at("maintenance", "read"), to: "/printers/maintenance" }],
    };
    expect(verdict(printersTab, { rights: maintenanceOnly })).toEqual({
      to: "/printers/maintenance",
      notice: false,
    });
  });

  it("takes either right", () => {
    const tasks = either(on("integrations.sync"), on("integrations.review"));
    expect(verdict({ need: tasks }, { rights: editor })).toBe("allow");
    expect(verdict({ need: tasks }, { rights: viewer })).toBe("cantOpen");
  });

  it("reads a settings page's access from the guard's lists", () => {
    const general = {
      need: cfg("prints", "settings"),
      otherwise: [
        { if: cfg("prints", "sources"), to: "/prints/settings/sources" },
        { if: at("prints", "read"), to: "/prints", notice: true as const },
      ],
    };
    // An editor with a review task: only Sources.
    expect(verdict(general, { rights: editor, cfg: { settings: false, sources: true } })).toEqual({
      to: "/prints/settings/sources",
      notice: false,
    });
    expect(verdict(general, { rights: viewer, cfg: { settings: false, sources: false } })).toEqual({
      to: "/prints",
      notice: true,
    });
    // Not loaded = not granted.
    expect(verdict({ need: cfg("prints", "settings") }, { rights: admin })).toBe("cantOpen");
    expect(cfgModule(general)).toBe("prints");
    expect(cfgModule(printerEdit)).toBeUndefined();
  });
});

it("a session is no guard; a right, or rights, are", () => {
  expect(guards(SESSION)).toBe(false);
  expect(guards(either(SESSION, at("printers", "read")))).toBe(false);
  expect(guards(either(on("hub.manage"), at("catalog", "manage")))).toBe(true);
});
