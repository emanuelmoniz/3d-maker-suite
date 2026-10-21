import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@3d-maker-suite/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { projectDocResolver } from "../lib/projects.ts";
import { Markdown } from "./Markdown.tsx";

// The app's own README: images (also in a table), a code block, link tables, sections.
const readme = readFileSync(join(import.meta.dirname, "../../../../README.md"), "utf8");

test("renders the README: tables, images, code, links; relative paths through resolve", () => {
  const html = renderToStaticMarkup(
    <Markdown resolve={(src) => (src.startsWith("docs/") ? `/f/${src}` : null)}>{readme}</Markdown>,
  );
  expect(html).toContain("<table");
  expect(html).toContain('src="/f/docs/images/dashboard.png"');
  expect(html).toContain('src="/f/docs/images/printers.png"'); // inside a table cell
  expect(html).toMatch(/<pre[^>]*><code/);
  expect(html).toContain('href="/f/docs/install.md"');
  expect(html).not.toContain("<!--");
});

test("drops relative images and unlinks relative links it can't resolve; web links open apart", () => {
  const html = renderToStaticMarkup(
    <Markdown>{"![a](pic.png) [doc](notes.md) [web](https://example.com)"}</Markdown>,
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="notes.md"');
  expect(html).toContain("doc");
  expect(html).toMatch(/<a[^>]*href="https:\/\/example.com"[^>]*target="_blank"/);
});

test("projectDocResolver: relative to the doc, inside the folder, listed files only", () => {
  const project = {
    id: "p1",
    meta: {
      files: [
        { path: "img/pic.png", kind: "image", size: 1 },
        { path: "docs/guide.md", kind: "doc", size: 1 },
      ],
    },
  } as unknown as Pick<Project, "id" | "meta">;
  const inDocs = projectDocResolver(project, "docs/README.md");
  expect(inDocs("../img/pic.png", "image")).toContain("path=img%2Fpic.png");
  expect(inDocs("./guide.md", "link")).toContain("path=docs%2Fguide.md");
  expect(inDocs("/img/pic.png", "image")).toContain("path=img%2Fpic.png"); // from the folder root
  expect(inDocs("../../outside.png", "image")).toBeNull();
  expect(inDocs("missing.png", "image")).toBeNull();
  expect(inDocs("guide.md", "image")).toBeNull(); // not an image
  expect(projectDocResolver(project, null)("img/pic.png", "image")).toContain("path=img%2Fpic.png");
});
