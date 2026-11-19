import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkWiki, headingAnchors } from "./wiki-check.mjs";

let root;
let wiki;
const write = (name, text) => writeFileSync(join(wiki, name), text);
const run = (map) => checkWiki(wiki, map);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-check-"));
  wiki = join(root, "wiki");
  mkdirSync(wiki);
  mkdirSync(join(root, "docs"));
  write("_Sidebar.md", "**[Home](Home.md)**\n\n- [Printers](Printers.md)\n");
  write("Home.md", "# Home\n");
  write("Printers.md", "# Printers\n\n## Printer details\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("headingAnchors", () => {
  it("writes anchors as GitHub does", () => {
    const a = headingAnchors(
      "# A & B: c?\n## Same\n## Same\n## `code` **bold**\n```\n# not\n```\n",
    );
    expect([...a]).toEqual(["a--b-c", "same", "same-1", "code-bold"]);
  });
});

describe("checkWiki", () => {
  it("passes a consistent wiki", () => {
    write("Home.md", "# Home\n[x](Printers.md#printer-details) [y](#home)\n");
    expect(run()).toEqual({ errors: [], pending: [] });
  });

  it("catches a link to a missing page", () => {
    write("Home.md", "[x](Nope.md)\n");
    expect(run().errors).toEqual(["Home.md: link Nope.md - page not found"]);
  });

  it("catches a missing heading on another page and on the same page", () => {
    write("Home.md", "# Home\n[x](Printers.md#gone) [y](#gone)\n");
    expect(run().errors).toEqual([
      "Home.md: link Printers.md#gone - no such heading",
      "Home.md: link #gone - no such heading",
    ]);
  });

  it("catches a missing image and accepts an existing one", () => {
    writeFileSync(join(root, "docs", "ok.png"), "x");
    write("Home.md", "![a](../docs/ok.png) ![b](../docs/missing.png)\n");
    expect(run().errors).toEqual(["Home.md: image ../docs/missing.png - file not found"]);
  });

  it("ignores external links and code", () => {
    write("Home.md", "[x](https://example.com/a.md)\n`[y](Nope.md)`\n```\n[z](Nope.md)\n```\n");
    expect(run().errors).toEqual([]);
  });

  it("catches a page missing from the sidebar", () => {
    write("Extra.md", "# Extra\n");
    expect(run().errors).toEqual(["Extra.md is not in _Sidebar.md"]);
  });

  it("catches a sidebar entry with no page", () => {
    write("_Sidebar.md", "[Home](Home.md)\n[Printers](Printers.md)\n[Gone](Gone.md)\n");
    const { errors } = run();
    expect(errors).toContain("_Sidebar.md: lists Gone, which has no page");
  });

  it("catches a page missing from WIKI_PAGES", () => {
    expect(run({ pages: ["Home"] }).errors).toEqual([
      "Printers.md is not in WIKI_PAGES (packages/core/src/wikiRoutes.ts)",
    ]);
  });

  it("catches a map entry whose heading is missing", () => {
    const routes = { "/printers/$id": { page: "Printers", section: "printer-gone" } };
    expect(run({ routes }).errors).toEqual([
      "route /printers/$id: Printers.md has no heading for #printer-gone",
    ]);
  });

  it("lists a map entry whose page isn't written as pending, not an error", () => {
    const routes = {
      "/printers/$id": { page: "Printers", section: "printer-details" },
      "/prints": { page: "Prints", section: "prints-list" },
    };
    expect(run({ routes })).toEqual({ errors: [], pending: ["/prints -> Prints#prints-list"] });
  });
});
