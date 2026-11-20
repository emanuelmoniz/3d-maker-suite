import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdownRenderer } from "vitepress";
import { beforeAll, describe, expect, it } from "vitest";
import { WIKI_PAGES, WIKI_ROUTES } from "../packages/core/src/wikiRoutes.ts";
import config from "../site/.vitepress/config.mjs";
import { pageDescription, sidebarFromMarkdown, siteLink } from "./docs-site.mjs";
import { headingAnchors } from "./wiki-check.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wiki = join(repo, "wiki");
const pages = readdirSync(wiki)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .map((f) => f.slice(0, -3));

describe("siteLink", () => {
  it.each([
    ["Printers.md", "/Printers"],
    ["./Printers.md#printer-details", "/Printers#printer-details"],
    ["Home.md", "/"],
    ["Home.md#using-this-guide", "/#using-this-guide"],
  ])("turns %s into %s", (target, link) => {
    expect(siteLink(target)).toBe(link);
  });

  it.each(["https://example.com", "../README.md", "sub/Page.md", "Printers"])(
    "refuses %s",
    (target) => {
      expect(() => siteLink(target)).toThrow(target);
    },
  );
});

describe("sidebarFromMarkdown", () => {
  it("makes top items and groups", () => {
    const text =
      "**[Home](Home.md)**\n\n### Get started\n\n- [First run](First-Run.md)\n* [Docker](Docker.md#on-a-nas)\n\n### Help\n\n- [FAQ](FAQ.md)\n";
    expect(sidebarFromMarkdown(text)).toEqual([
      { text: "Home", link: "/" },
      {
        text: "Get started",
        items: [
          { text: "First run", link: "/First-Run" },
          { text: "Docker", link: "/Docker#on-a-nas" },
        ],
      },
      { text: "Help", items: [{ text: "FAQ", link: "/FAQ" }] },
    ]);
  });

  it.each([
    ["text it can't place", "Some words\n"],
    ["a list item before any group", "- [FAQ](FAQ.md)\n"],
    ["a link that isn't a wiki page", "### Help\n\n- [Repo](https://github.com)\n"],
  ])("refuses %s", (_, text) => {
    expect(() => sidebarFromMarkdown(text)).toThrow();
  });

  it("lists every page of the real sidebar once, in WIKI_PAGES order", () => {
    const links = config.themeConfig.sidebar
      .flatMap((item) => item.items ?? [item])
      .map((item) => (item.link === "/" ? "Home" : item.link.slice(1)));
    expect(links).toEqual([...WIKI_PAGES]);
  });
});

describe("pageDescription", () => {
  it("takes the first paragraph under the title, as plain text", () => {
    const text =
      "# Printers\n\nYour **printers**: the [list](Printers.md#list), `one` and\n<https://example.com>.\n\nMore.\n";
    expect(pageDescription(text)).toBe("Your printers: the list, one and https://example.com.");
  });

  it("skips images, lists, tables, quotes and code before it", () => {
    const text =
      "# A\n\n![shot](../docs/images/a.png)\n\n- item\n\n| a |\n|---|\n\n> quote\n\n```\ncode\n```\n\nThe text.\n";
    expect(pageDescription(text)).toBe("The text.");
  });

  it("keeps an asterisk inside words and drops emphasis around them", () => {
    expect(pageDescription("# A\n\n*Only* 2*3 counts.\n")).toBe("Only 2*3 counts.");
  });

  it("has none when a section starts first, or the page has no paragraph", () => {
    expect(pageDescription("# A\n\n## Section\n\nText.\n")).toBeUndefined();
    expect(pageDescription("# A\n\n- item\n")).toBeUndefined();
  });

  it("finds one for every wiki page", () => {
    for (const page of pages)
      expect(pageDescription(readFileSync(join(wiki, `${page}.md`), "utf8")), page).toBeTruthy();
  });
});

describe("the site's Markdown", () => {
  let md;
  const render = (text, relativePath = "Page.md") =>
    md.render(text, { relativePath, path: join(wiki, relativePath), cleanUrls: true });
  const ids = (html) => [...html.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1]);

  beforeAll(async () => {
    md = await createMarkdownRenderer(config.srcDir, config.markdown, config.base);
  }, 30_000);

  it("gives headings GitHub's anchors", () => {
    const text = [
      "# Bambu Cloud & LAN",
      "## Who can use it?",
      "## Who can use it?",
      "## Import / export `CSV` files",
      "## [Linked](Printers.md) **bold** _em_ snake_case",
      "## Ünïcode 🎉 done",
      "## 3D Maker Suite",
    ].join("\n\n");
    expect(ids(render(text))).toEqual([...headingAnchors(text)]);
  });

  it("gives every wiki page the anchors wiki:check knows, so the route map holds", () => {
    for (const page of pages) {
      const text = readFileSync(join(wiki, `${page}.md`), "utf8");
      const file = page === "Home" ? "index.md" : `${page}.md`;
      expect(new Set(ids(render(text, file))), page).toEqual(headingAnchors(text));
    }
    for (const { page, section } of Object.values(WIKI_ROUTES))
      expect(headingAnchors(readFileSync(join(wiki, `${page}.md`), "utf8")).has(section)).toBe(
        true,
      );
  });

  it("ends every page with _Footer.md", () => {
    const footer = readFileSync(join(wiki, "_Footer.md"), "utf8").trim();
    const html = render("# A\n\nText.\n");
    expect(html).toMatch(/<hr>\s*<p><a href="https:\/\/github\.com\/emanuelmoniz\/3d-maker-suite"/);
    expect(html.indexOf("<hr>")).toBeGreaterThan(html.indexOf("Text."));
    expect(footer).toMatch(/^\[.+\]\(https:\/\//);
  });

  it("leaves inline text alone", () => {
    expect(md.renderInline("Printers")).toBe("Printers");
  });

  it("shows the logo as the home page's title, keeping its anchor", () => {
    const html = render("# 3D Maker Suite\n\nText.\n", "index.md");
    expect(html).toMatch(
      /<h1 id="3d-maker-suite"[^>]*><img class="home-logo" src="..\/docs\/brand\/logo-color-horizontal.svg" alt="3D Maker Suite">/,
    );
    expect(render("# 3D Maker Suite\n", "Printers.md")).not.toContain("home-logo");
  });
});

describe("the site's config", () => {
  it("builds wiki/ for the docs address, with search and a sitemap", () => {
    expect(config.srcDir).toBe(wiki);
    expect(config.base).toBe("/3d-maker-suite/");
    expect(config.sitemap.hostname).toBe("https://emanuelmoniz.github.io/3d-maker-suite/");
    expect(config.rewrites).toEqual({ "Home.md": "index.md" });
    expect(config.srcExclude).toEqual(["_Sidebar.md", "_Footer.md"]);
    expect(config.themeConfig.search.provider).toBe("local");
    expect(JSON.stringify(config)).not.toMatch(/noindex/i);
  });

  it("gives each page its description and canonical address", () => {
    const pageData = {
      filePath: "Printers.md",
      relativePath: "Printers.md",
      frontmatter: {},
      description: "",
    };
    config.transformPageData(pageData);
    expect(pageData.description).toMatch(/^Your printers: /);
    expect(pageData.frontmatter.head).toEqual([
      [
        "link",
        { rel: "canonical", href: "https://emanuelmoniz.github.io/3d-maker-suite/Printers" },
      ],
    ]);
    const home = {
      filePath: "Home.md",
      relativePath: "index.md",
      frontmatter: {},
      description: "",
    };
    config.transformPageData(home);
    expect(home.frontmatter.head[0][1].href).toBe("https://emanuelmoniz.github.io/3d-maker-suite/");
  });
});
