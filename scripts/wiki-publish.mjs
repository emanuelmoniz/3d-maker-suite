// Builds the GitHub wiki from `wiki/` into a clone of the wiki repository: converts links and images,
// copies the images used, and mirrors the result so a page removed from `wiki/` leaves the wiki too.
// The workflow in .github/workflows/wiki.yml commits and pushes what this writes.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IMAGE_PREFIX = "../docs/images/";

/** A fenced block or inline code (kept as written), or the start of a link's destination. */
const TOKENS = /(^(```|~~~)[\s\S]*?^\2.*$|`[^`\n]*`)|(\]\(\s*<?)([^)\s>]+)/gm;

function convertTarget(target, images) {
  if (target.startsWith("#") || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return target;
  const page = target.match(/^(?:\.\/)?([^/#]+)\.md(#.*)?$/);
  if (page) return `${page[1]}${page[2] ?? ""}`;
  if (target.startsWith(IMAGE_PREFIX)) {
    const image = target.slice(IMAGE_PREFIX.length);
    if (image !== "" && !image.split("/").includes("..")) {
      images.add(image);
      return `images/${image}`;
    }
  }
  throw new Error(`${target} would not work on the wiki`);
}

/**
 * Rewrites link and image destinations for the wiki. Code is left as written.
 * @param {string} text
 * @returns {{ text: string, images: string[] }} the new text and the images it uses
 */
export function convertLinks(text) {
  const images = new Set();
  const converted = text.replace(TOKENS, (match, code, _fence, open, target) =>
    code ? match : `${open}${convertTarget(target, images)}`,
  );
  return { text: converted, images: [...images] };
}

/**
 * Makes `outDir` an exact copy of the converted wiki. Only `.git` survives.
 * Everything is converted first, so a bad link leaves `outDir` untouched.
 * @param {string} wikiDir
 * @param {string} outDir
 * @param {string} imagesDir
 */
export function publishWiki(wikiDir, outDir, imagesDir) {
  const pages = new Map();
  const images = new Set();
  for (const file of readdirSync(wikiDir).filter((f) => f.endsWith(".md"))) {
    try {
      const page = convertLinks(readFileSync(join(wikiDir, file), "utf8"));
      pages.set(file, page.text);
      for (const image of page.images) images.add(image);
    } catch (err) {
      throw new Error(`${file}: ${err.message}`);
    }
  }
  const known = new Set(
    readdirSync(imagesDir, { recursive: true }).map((f) => String(f).replaceAll("\\", "/")),
  );
  for (const image of images)
    if (!known.has(image)) throw new Error(`image not found: docs/images/${image}`);

  for (const entry of readdirSync(outDir))
    if (entry !== ".git") rmSync(join(outDir, entry), { recursive: true, force: true });
  for (const [file, text] of pages) writeFileSync(join(outDir, file), text);
  for (const image of images) {
    const target = join(outDir, "images", image);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(imagesDir, image), target);
  }
}

/** Only a stable release tag pushed to the repo publishes: never -alpha, -rc or -build. */
export function shouldPublishOnRelease(event, tag) {
  return event === "push" && /^v\d+\.\d+\.\d+$/.test(tag);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [first, event, tag] = process.argv.slice(2);
  if (first === "--release-check") {
    console.log(String(shouldPublishOnRelease(event, tag)));
    return;
  }
  if (!first) {
    console.error("usage: wiki-publish.mjs <wiki clone> | --release-check <event> <tag>");
    process.exit(1);
  }
  publishWiki(join(root, "wiki"), resolve(first), join(root, "docs/images"));
  console.log(`wiki built in ${first}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
