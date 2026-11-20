// Turns the wiki source in `wiki/` into what the documentation site needs: the sidebar from
// `_Sidebar.md`, `_Footer.md` under every page, the logo on the home page, and each page's
// description. site/.vitepress/config.mjs uses these; `wiki/` itself never changes.

/** `Page.md#anchor` from the wiki -> the site's address under its base. Home is the site's root. */
export function siteLink(target) {
  const m = target.match(/^(?:\.\/)?([^/#]+)\.md(#.*)?$/);
  if (!m) throw new Error(`not a wiki page link: ${target}`);
  return `/${m[1] === "Home" ? "" : m[1]}${m[2] ?? ""}`;
}

/**
 * `_Sidebar.md` -> VitePress sidebar items. A link on its own line (the bold Home) is a top item,
 * each `### Group` starts a group, and the list items under it are its pages.
 * @param {string} text
 */
export function sidebarFromMarkdown(text) {
  const items = [];
  let group = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const heading = line.match(/^###[ \t]+(.+?)[ \t]*$/);
    if (heading) {
      group = { text: heading[1], items: [] };
      items.push(group);
      continue;
    }
    const link = line.match(/^([ \t]*[-*][ \t]+)?(\*\*)?\[([^\]]+)\]\(([^)\s]+)\)\2[ \t]*$/);
    if (!link) throw new Error(`_Sidebar.md: can't read "${line}"`);
    const [, bullet, , label, target] = link;
    if (bullet && !group) throw new Error(`_Sidebar.md: "${line}" is a list item before any group`);
    (bullet ? group.items : items).push({ text: label, link: siteLink(target) });
  }
  return items;
}

/** Markdown inline text -> plain text: links keep their text, images and emphasis marks go. */
const plain = (text) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/\*\*|`|(?<!\w)\*|\*(?!\w)/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The page's description for search results: the first paragraph under its title, which every
 * page uses to say what it is for (docs/wiki-guide.md). Undefined when there is none.
 * @param {string} text the page's Markdown
 */
export function pageDescription(text) {
  const blocks = text
    .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "")
    .split(/\r?\n[ \t]*\r?\n/)
    .map((b) => b.trim());
  const title = blocks.findIndex((b) => /^#[ \t]/.test(b));
  for (const block of blocks.slice(title + 1)) {
    if (/^#{1,6}[ \t]/.test(block)) return undefined;
    // Not a paragraph: a list, quote, table, HTML or an image on its own.
    if (block === "" || /^([-*+][ \t]|[>|<]|\d+[.)][ \t]|!\[)/.test(block)) continue;
    const description = plain(block);
    if (description !== "") return description;
  }
  return undefined;
}

/**
 * markdown-it plugin: `_Footer.md` at the end of every page. The theme's own footer is hidden on
 * pages with a sidebar, and the wiki shows its footer on every page.
 * @param {string} footer the footer's Markdown
 */
export const wikiFooter = (footer) => (md) => {
  md.core.ruler.before("normalize", "wiki-footer", (state) => {
    if (state.inlineMode) return;
    state.src = `${state.src.trimEnd()}\n\n---\n\n${footer.trim()}\n`;
  });
};

/**
 * markdown-it plugin: on the home page the title shows the logo, as in the README. The heading
 * keeps its text's anchor, and the image's alt text is its accessible name.
 * @param {{ src: string, alt: string, page?: string }} logo `src` relative to the page's source file
 */
export const homeLogo =
  ({ src, alt, page = "index.md" }) =>
  (md) => {
    md.core.ruler.push("home-logo", (state) => {
      if (state.inlineMode || state.env?.relativePath !== page) return;
      const i = state.tokens.findIndex((t) => t.type === "heading_open" && t.tag === "h1");
      if (i === -1) return;
      const img = new state.Token("html_inline", "", 0);
      img.content = `<img class="home-logo" src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}">`;
      state.tokens[i + 1].children = [img];
    });
  };
