// Checks the wiki source in `wiki/`: page links, heading anchors, images, the sidebar, and the route
// map in packages/core/src/wikiRoutes.ts. A map entry whose page isn't written yet is "pending";
// `--strict` makes pending an error.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SPECIAL = new Set(["_Sidebar", "_Footer"]);

/** Markdown text without fenced code blocks and inline code, so their contents aren't read as links. */
const stripFences = (text) => text.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "");
const stripCode = (text) => stripFences(text).replace(/`[^`\n]*`/g, "");

/**
 * GitHub's slug for a heading's plain text, before repeats get -1, -2, ... The documentation site
 * (site/.vitepress/config.mjs) uses it too, so its anchors are the wiki's.
 */
export const githubSlug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

/** The anchor GitHub makes from a heading; repeated headings get -1, -2, ... */
export function headingAnchors(text) {
  const seen = new Map();
  const anchors = new Set();
  for (const m of stripFences(text).matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const base = githubSlug(m[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*~`]/g, ""));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const pageFiles = (wikiDir) =>
  readdirSync(wikiDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));

/**
 * @param {string} wikiDir
 * @param {{ pages?: readonly string[], routes?: Record<string, {page: string, section: string}> }} map
 * @returns {{ errors: string[], pending: string[] }}
 */
export function checkWiki(wikiDir, { pages, routes = {} } = {}) {
  const errors = [];
  const pending = [];
  const names = pageFiles(wikiDir);
  const texts = new Map(names.map((n) => [n, readFileSync(join(wikiDir, `${n}.md`), "utf8")]));
  const anchors = new Map([...texts].map(([n, t]) => [n, headingAnchors(t)]));

  for (const [name, text] of texts) {
    for (const m of stripCode(text).matchAll(
      /(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    )) {
      const [, bang, target] = m;
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
      const [path, hash] = target.split("#");
      const at = `${name}.md: ${bang ? "image" : "link"} ${target}`;
      if (path === "") {
        if (hash && !anchors.get(name).has(hash)) errors.push(`${at} - no such heading`);
        continue;
      }
      if (!existsSync(resolve(wikiDir, path))) {
        errors.push(`${at} - ${bang ? "file" : "page"} not found`);
        continue;
      }
      if (hash && path.endsWith(".md") && dirname(resolve(wikiDir, path)) === resolve(wikiDir)) {
        const page = path.replace(/^\.\//, "").slice(0, -3);
        if (!anchors.get(page)?.has(hash)) errors.push(`${at} - no such heading`);
      }
    }
  }

  // Sidebar and pages must match.
  const sidebar = texts.get("_Sidebar");
  if (sidebar === undefined) errors.push("_Sidebar.md is missing");
  else {
    const listed = new Set();
    for (const m of stripCode(sidebar).matchAll(/\]\(([^)#\s]+)\.md(?:#[^)]*)?\)/g)) {
      listed.add(m[1]);
      if (!texts.has(m[1])) errors.push(`_Sidebar.md: lists ${m[1]}, which has no page`);
    }
    for (const n of names)
      if (!SPECIAL.has(n) && !listed.has(n)) errors.push(`${n}.md is not in _Sidebar.md`);
  }
  if (pages)
    for (const n of names)
      if (!SPECIAL.has(n) && !pages.includes(n))
        errors.push(`${n}.md is not in WIKI_PAGES (packages/core/src/wikiRoutes.ts)`);

  // Route map.
  for (const [route, { page, section }] of Object.entries(routes)) {
    if (!texts.has(page)) pending.push(`${route} -> ${page}#${section}`);
    else if (!anchors.get(page).has(section))
      errors.push(`route ${route}: ${page}.md has no heading for #${section}`);
  }
  return { errors, pending };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const strict = process.argv.includes("--strict");
  const { WIKI_PAGES, WIKI_ROUTES } = await import(
    pathToFileURL(join(root, "packages/core/src/wikiRoutes.ts")).href
  );
  const { errors, pending } = checkWiki(join(root, "wiki"), {
    pages: WIKI_PAGES,
    routes: WIKI_ROUTES,
  });
  for (const e of errors) console.error(`error: ${e}`);
  if (pending.length > 0) {
    const label = strict ? "error: pending" : "pending";
    const write = strict ? console.error : console.log;
    const pagesPending = new Set(pending.map((p) => p.split(" -> ")[1].split("#")[0]));
    write(`${label}: ${pending.length} screens on ${pagesPending.size} pages not written yet`);
    if (strict) for (const p of pending) write(`  ${p}`);
  }
  if (errors.length > 0 || (strict && pending.length > 0)) process.exit(1);
  console.log(`wiki:check passed${pending.length > 0 ? " (with pending pages)" : ""}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
