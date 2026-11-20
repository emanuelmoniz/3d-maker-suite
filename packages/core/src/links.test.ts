import { describe, expect, it } from "vitest";
import { docsUrl } from "./links.ts";
import { wikiTarget } from "./wikiRoutes.ts";

describe("Help links", () => {
  it("docsUrl opens the app's own copy of the guide, at a section", () => {
    expect(docsUrl("Home")).toBe("/guide/");
    expect(docsUrl("Printers")).toBe("/guide/Printers");
    expect(docsUrl("Printers", "printer-details")).toBe("/guide/Printers#printer-details");
  });

  it("wikiTarget finds a route as the router writes it", () => {
    expect(wikiTarget("/")).toEqual({ page: "Dashboard", section: "dashboard" });
    expect(wikiTarget("/printers/$id")).toEqual({ page: "Printers", section: "printer-details" });
    // An index route under a layout ends in a slash.
    expect(wikiTarget("/settings/")).toEqual({ page: "Settings-General", section: "general" });
    expect(wikiTarget("/design")).toBeUndefined();
    expect(wikiTarget("toString")).toBeUndefined();
  });
});
