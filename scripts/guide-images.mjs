// The guide inside the app (Step 0b of Plan 6.2.0) ships its screenshots as WebP: about 40% of the
// PNGs' size. The site build rewrites each PNG a page uses to the converted copy made here.
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";

// The files are written again and deleted while the process lives: no file cache (Windows locks them).
sharp.cache(false);

/**
 * Converts every PNG in `from` to WebP in `to`, skipping files already converted since the PNG last
 * changed. Returns the converted file's name for each PNG's name.
 * @param {string} from
 * @param {string} to
 * @returns {Promise<Map<string, string>>}
 */
export async function convertImages(from, to) {
  mkdirSync(to, { recursive: true });
  const names = new Map();
  await Promise.all(
    readdirSync(from)
      .filter((f) => /\.png$/i.test(f))
      .map(async (f) => {
        const webp = `${basename(f, ".png")}.webp`;
        names.set(f, webp);
        const out = join(to, webp);
        if (existsSync(out) && statSync(out).mtimeMs >= statSync(join(from, f)).mtimeMs) return;
        await sharp(join(from, f)).webp({ quality: 80, effort: 6 }).toFile(out);
      }),
  );
  return names;
}

/**
 * markdown-it plugin: image sources that point into `prefix` (a PNG) point to its WebP copy in `to`
 * instead, both written relative to the page's folder as the wiki writes them.
 * @param {{ prefix: string, to: string, names: Map<string, string> }} o
 */
export const webpImages =
  ({ prefix, to, names }) =>
  (md) => {
    md.core.ruler.push("webp-images", (state) => {
      const walk = (tokens) => {
        for (const t of tokens) {
          if (t.type === "image") {
            const src = t.attrGet("src") ?? "";
            const file = src.startsWith(prefix) ? names.get(src.slice(prefix.length)) : undefined;
            if (file) t.attrSet("src", `${to}${file}`);
          }
          if (t.children) walk(t.children);
        }
      };
      walk(state.tokens);
    });
  };
