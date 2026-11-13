// Makes icon.ico, icon.icns and icon.png from docs/brand/icon-color.svg. Run once when the logo
// changes (node packaging/make-icons.mjs) and commit the results; the build only copies them.
// No new dependency: Playwright (already a dev dependency) rasterizes the SVG, and both formats
// accept PNG data as is, so the containers are written by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const here = new URL(".", import.meta.url);
const svg = readFileSync(new URL("../docs/brand/icon-color.svg", import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
const png = async (s) => {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(
    `<body style="margin:0"><img style="width:${s}px;height:${s}px;display:block" src="data:image/svg+xml;base64,${svg.toString("base64")}">`,
  );
  return page.screenshot({ omitBackground: true });
};
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const img = {};
for (const s of sizes) img[s] = await png(s); // one page: sequential
await browser.close();

writeFileSync(new URL("icon.png", here), img[512]);

// ICO: header, one 16-byte entry per size (0 = 256), then the PNGs.
const ico = [16, 32, 48, 64, 128, 256];
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(ico.length, 4);
let off = head.length;
ico.forEach((s, i) => {
  const e = 6 + 16 * i;
  head[e] = head[e + 1] = s === 256 ? 0 : s;
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(img[s].length, e + 8);
  head.writeUInt32LE(off, e + 12);
  off += img[s].length;
});
writeFileSync(new URL("icon.ico", here), Buffer.concat([head, ...ico.map((s) => img[s])]));

// ICNS: "icns", total length, then type + length + PNG per size.
const icns = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };
const parts = Object.entries(icns).map(([type, s]) => {
  const h = Buffer.alloc(8);
  h.write(type, 0, "ascii");
  h.writeUInt32BE(8 + img[s].length, 4);
  return Buffer.concat([h, img[s]]);
});
const top = Buffer.alloc(8);
top.write("icns", 0, "ascii");
top.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4);
writeFileSync(new URL("icon.icns", here), Buffer.concat([top, ...parts]));
