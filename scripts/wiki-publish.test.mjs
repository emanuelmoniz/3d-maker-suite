import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convertLinks, publishWiki, shouldPublishOnRelease } from "./wiki-publish.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("convertLinks", () => {
  it.each([
    ["[a](Printers.md)", "[a](Printers)"],
    ["[a](Printers.md#printer-details)", "[a](Printers#printer-details)"],
    ["[a](./Printers.md#b)", "[a](Printers#b)"],
    ['[a](Printers.md "Title")', '[a](Printers "Title")'],
    ["[a](<Printers.md>)", "[a](<Printers>)"],
    ["[a](#fields)", "[a](#fields)"],
    ["[a](https://example.com/x.md)", "[a](https://example.com/x.md)"],
    ["[a](mailto:a@example.com)", "[a](mailto:a@example.com)"],
  ])("turns %s into %s", (input, output) => {
    expect(convertLinks(input)).toEqual({ text: output, images: [] });
  });

  it("converts images and lists each one once", () => {
    const { text, images } = convertLinks(
      "![a](../docs/images/x.png) ![b](../docs/images/sub/y.png) ![c](../docs/images/x.png)",
    );
    expect(text).toBe("![a](images/x.png) ![b](images/sub/y.png) ![c](images/x.png)");
    expect(images).toEqual(["x.png", "sub/y.png"]);
  });

  it("converts an image inside a link", () => {
    expect(convertLinks("[![a](../docs/images/x.png)](Printers.md)").text).toBe(
      "[![a](images/x.png)](Printers)",
    );
  });

  it("leaves code as written", () => {
    const text = "`[a](Nope.md)`\n\n```md\n[b](../other/Nope.md)\n```\n\n~~~\n[c](Nope.md)\n~~~\n";
    expect(convertLinks(text)).toEqual({ text, images: [] });
  });

  it.each(["../docs/hub.md", "../README.md", "sub/Page.md", "../docs/images/../secret.png"])(
    "refuses %s, which would break on the wiki",
    (target) => {
      expect(() => convertLinks(`[a](${target})`)).toThrow(target);
    },
  );
});

describe("publishWiki", () => {
  let root;
  let wiki;
  let out;
  let images;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "wiki-publish-"));
    wiki = join(root, "wiki");
    out = join(root, "out");
    images = join(root, "images");
    for (const dir of [wiki, join(out, ".git"), join(images, "sub")]) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(out, ".git", "HEAD"), "ref");
    writeFileSync(join(images, "used.png"), "used");
    writeFileSync(join(images, "sub", "deep.png"), "deep");
    writeFileSync(join(images, "unused.png"), "unused");
    writeFileSync(
      join(wiki, "Home.md"),
      "[a](Printers.md#b)\n![x](../docs/images/used.png)\n![y](../docs/images/sub/deep.png)\n",
    );
    writeFileSync(join(wiki, "Printers.md"), "# Printers\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const snapshot = () =>
    readdirSync(out, { recursive: true })
      .map((f) => String(f).replaceAll("\\", "/"))
      .sort();

  it("writes converted pages and only the images used", () => {
    publishWiki(wiki, out, images);
    expect(readFileSync(join(out, "Home.md"), "utf8")).toBe(
      "[a](Printers#b)\n![x](images/used.png)\n![y](images/sub/deep.png)\n",
    );
    expect(readFileSync(join(out, "images", "used.png"), "utf8")).toBe("used");
    expect(readFileSync(join(out, "images", "sub", "deep.png"), "utf8")).toBe("deep");
    expect(existsSync(join(out, "images", "unused.png"))).toBe(false);
  });

  it("removes what left the wiki and keeps .git", () => {
    writeFileSync(join(out, "Old-Page.md"), "old");
    mkdirSync(join(out, "images"));
    writeFileSync(join(out, "images", "old.png"), "old");
    publishWiki(wiki, out, images);
    expect(existsSync(join(out, "Old-Page.md"))).toBe(false);
    expect(existsSync(join(out, "images", "old.png"))).toBe(false);
    expect(readFileSync(join(out, ".git", "HEAD"), "utf8")).toBe("ref");
  });

  it("gives the same result on a second run", () => {
    publishWiki(wiki, out, images);
    const files = snapshot();
    const home = readFileSync(join(out, "Home.md"), "utf8");
    publishWiki(wiki, out, images);
    expect(snapshot()).toEqual(files);
    expect(readFileSync(join(out, "Home.md"), "utf8")).toBe(home);
  });

  it("fails on a missing image and leaves the clone untouched", () => {
    writeFileSync(join(out, "Kept.md"), "kept");
    writeFileSync(join(wiki, "Home.md"), "![x](../docs/images/missing.png)\n");
    expect(() => publishWiki(wiki, out, images)).toThrow("docs/images/missing.png");
    expect(existsSync(join(out, "Kept.md"))).toBe(true);
  });

  it("names the page with a bad link and leaves the clone untouched", () => {
    writeFileSync(join(out, "Kept.md"), "kept");
    writeFileSync(join(wiki, "Printers.md"), "[a](../README.md)\n");
    expect(() => publishWiki(wiki, out, images)).toThrow("Printers.md: ../README.md");
    expect(existsSync(join(out, "Kept.md"))).toBe(true);
  });
});

describe("shouldPublishOnRelease", () => {
  it.each([
    ["push", "v6.2.0", true],
    ["push", "v10.20.30", true],
    ["push", "v6.2.0-alpha.1", false],
    ["push", "v6.2.0-rc.1", false],
    ["push", "v6.2.0-build.42", false],
    ["push", "6.2.0", false],
    ["workflow_dispatch", "v6.2.0", false],
    ["workflow_dispatch", "v6.2.0-build.42", false],
  ])("%s of %s: %s", (event, tag, expected) => {
    expect(shouldPublishOnRelease(event, tag)).toBe(expected);
  });
});

describe("workflows", () => {
  const workflow = (name) => readFileSync(join(repo, ".github/workflows", name), "utf8");

  /** The text of one job: from `  name:` to the next job or the end. */
  const job = (text, name) => {
    const start = text.indexOf(`\n  ${name}:\n`);
    expect(start, `job ${name}`).toBeGreaterThan(-1);
    const next = text.slice(start + 1).search(/\n {2}[\w-]+:\n/);
    return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
  };

  it("release.yml publishes the guide last, and only when the release check says so", () => {
    const release = workflow("release.yml");
    expect(release).toMatch(/publish_wiki: \$\{\{ steps\.tag\.outputs\.publish_wiki \}\}/);
    expect(release).toContain('--release-check "$GITHUB_EVENT_NAME" "$TAG"');
    const wiki = job(release, "wiki");
    expect(wiki).toContain("needs: [check, docker]");
    expect(wiki).toContain("if: needs.check.outputs.publish_wiki == 'true'");
    // A called workflow gets no more than its caller grants: the wiki push and the Pages deploy.
    for (const p of ["contents: write", "pages: write", "id-token: write"])
      expect(wiki).toContain(p);
    expect(wiki).toContain("uses: ./.github/workflows/wiki.yml");
  });

  it("wiki.yml checks and builds the site before anything publishes", () => {
    const wiki = workflow("wiki.yml");
    expect(wiki).toContain("workflow_dispatch:");
    expect(wiki).toContain("workflow_call:");
    const build = job(wiki, "build");
    const steps = ["wiki-check.mjs --strict", "pnpm docs:build", "upload-pages-artifact"];
    const at = steps.map((s) => build.indexOf(s));
    expect(at.every((i) => i > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(job(wiki, "site")).toContain("needs: build");
    expect(job(wiki, "publish")).toContain("needs: build");
  });

  it("wiki.yml grants each job only what it needs", () => {
    const wiki = workflow("wiki.yml");
    expect(wiki).toMatch(/^permissions: \{\}$/m);
    expect(job(wiki, "build")).toContain("contents: read");
    expect(job(wiki, "build")).not.toMatch(/: write/);
    const site = job(wiki, "site");
    expect(site).toContain("pages: write");
    expect(site).toContain("id-token: write");
    expect(site).toContain("name: github-pages");
    expect(site).not.toContain("contents: write");
    const publish = job(wiki, "publish");
    expect(publish).toContain("contents: write");
    expect(publish).not.toMatch(/pages: write|id-token: write/);
    expect(wiki.match(/contents: write/g)).toHaveLength(1);
    expect(wiki.match(/pages: write/g)).toHaveLength(1);
    expect(wiki.match(/id-token: write/g)).toHaveLength(1);
  });
});
