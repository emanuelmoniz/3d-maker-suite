// The documentation site, built from `wiki/` as it is (docs/wiki-guide.md). `pnpm docs:dev` serves
// it locally, `pnpm docs:build` writes site/dist, and .github/workflows/wiki.yml publishes it.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";
import { DOCS_URL, REPO_URL } from "../../packages/core/src/links.ts";
import {
  homeLogo,
  pageDescription,
  sidebarFromMarkdown,
  wikiFooter,
} from "../../scripts/docs-site.mjs";
import { githubSlug } from "../../scripts/wiki-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const wiki = join(repo, "wiki");
const read = (file) => readFileSync(join(wiki, file), "utf8");
const site = `${DOCS_URL}/`;
const base = new URL(site).pathname;
const description =
  "User guide for 3D Maker Suite: printers, maintenance, filament, projects, prints, costs and stats.";

export default defineConfig({
  title: "3D Maker Suite",
  description,
  lang: "en",
  base,
  srcDir: wiki,
  outDir: resolve(here, "../dist"),
  cacheDir: resolve(here, "cache"),
  srcExclude: ["_Sidebar.md", "_Footer.md"],
  // The wiki's Home is the site's root; every other page keeps the wiki's address.
  rewrites: { "Home.md": "index.md" },
  cleanUrls: true,
  // The guide links to the app on the user's own computer (http://localhost:4300) on purpose.
  ignoreDeadLinks: "localhostLinks",
  sitemap: { hostname: site },
  // Brand files (docs/brand) are served from the site's root: the favicon and the nav logo.
  // The search index (about 600 kB) is one chunk, loaded only when search opens.
  vite: { publicDir: join(repo, "docs/brand"), build: { chunkSizeWarningLimit: 1024 } },
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${base}icon-color.svg` }]],
  markdown: {
    // GitHub's anchors, so wiki links, `pnpm wiki:check` and the route map hold on the site too.
    anchor: { slugify: githubSlug },
    config(md) {
      md.use(wikiFooter(read("_Footer.md")));
      md.use(homeLogo({ src: "../docs/brand/logo-color-horizontal.svg", alt: "3D Maker Suite" }));
    },
  },
  transformPageData(pageData) {
    if (pageData.isNotFound) return;
    const text = readFileSync(join(wiki, pageData.filePath), "utf8");
    pageData.description = pageDescription(text) ?? description;
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(["link", { rel: "canonical", href: `${site}${path}` }]);
  },
  themeConfig: {
    logo: "/icon-color.svg",
    sidebar: sidebarFromMarkdown(read("_Sidebar.md")),
    search: { provider: "local" },
    outline: { level: [2, 3] },
    socialLinks: [{ icon: "github", link: REPO_URL }],
  },
});
