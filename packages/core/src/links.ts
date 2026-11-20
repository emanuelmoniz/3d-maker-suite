import type { WikiPage } from "./wikiRoutes.ts";

/** Project links, shared by the server (release API) and the web footer. */
export const REPO_URL = "https://github.com/emanuelmoniz/3d-maker-suite";
export const SITE_URL = "https://azseashell.com";
/** The GitHub wiki: a mirror of the guide, kept so older links keep working. */
export const WIKI_URL = `${REPO_URL}/wiki`;
/** The documentation site, built from `wiki/` (site/.vitepress/config.mjs). Pages keep the wiki's names. */
export const DOCS_URL = "https://emanuelmoniz.github.io/3d-maker-suite";

/**
 * A guide page (and section) in the copy the app serves at `/guide/` (Step 0b of Plan 6.2.0): it
 * matches the installed version and works offline, and links to the public site (`DOCS_URL`).
 * Relative, so it opens on whatever address the app was reached on.
 */
export const docsUrl = (page: WikiPage, section?: string) =>
  `/guide/${page === "Home" ? "" : page}${section ? `#${section}` : ""}`;
