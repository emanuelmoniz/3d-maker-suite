import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createMarkdownRenderer } from "vitepress";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convertImages, webpImages } from "./guide-images.mjs";

const dir = mkdtempSync(join(tmpdir(), "guide-images-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const png = (w) =>
  sharp({ create: { width: w, height: w, channels: 3, background: "#369" } })
    .png()
    .toBuffer();

describe("convertImages", () => {
  it("writes a WebP per PNG, skips other files, and keeps a copy that is up to date", async () => {
    const from = join(dir, "from");
    const to = join(dir, "to");
    mkdirSync(from);
    writeFileSync(join(from, "a.png"), await png(64));
    writeFileSync(join(from, "notes.txt"), "x");
    const names = await convertImages(from, to);
    expect([...names]).toEqual([["a.png", "a.webp"]]);
    expect(readdirSync(to)).toEqual(["a.webp"]);
    expect((await sharp(join(to, "a.webp")).metadata()).format).toBe("webp");
    const first = statSync(join(to, "a.webp")).mtimeMs;
    await convertImages(from, to);
    expect(statSync(join(to, "a.webp")).mtimeMs).toBe(first);
    // A changed PNG is converted again.
    writeFileSync(join(from, "a.png"), await png(32));
    utimesSync(join(from, "a.png"), new Date(), new Date(Date.now() + 5000));
    await convertImages(from, to);
    expect((await sharp(join(to, "a.webp")).metadata()).width).toBe(32);
  });
});

describe("webpImages", () => {
  let md;
  beforeAll(async () => {
    md = await createMarkdownRenderer(dir, {
      config: (m) =>
        m.use(
          webpImages({
            prefix: "../docs/images/",
            to: "../cache/",
            names: new Map([["a.png", "a.webp"]]),
          }),
        ),
    });
  });

  it("points the images of the shared folder to their WebP copy", () => {
    expect(md.render("![A](../docs/images/a.png)")).toContain("../cache/a.webp");
  });

  it("leaves other images alone, also in a list", () => {
    const html = md.render("- ![B](../docs/images/b.png)\n- ![C](https://x.test/c.png)");
    expect(html).toContain("../docs/images/b.png");
    expect(html).toContain('src="https://x.test/c.png"');
  });
});
