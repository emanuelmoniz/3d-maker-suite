// Builds the copy of the guide the app ships (Step 0b of Plan 6.2.0) into apps/web/dist/guide, where
// the server serves it at /guide/. Run it after the web build, which empties apps/web/dist; the
// release build (packaging/build.mjs) and the Dockerfile do. Needs wiki/ and docs/images.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vitepress = fileURLToPath(
  new URL("../node_modules/vitepress/bin/vitepress.js", import.meta.url),
);
execFileSync(process.execPath, [vitepress, "build", "site"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, GUIDE: "app" },
});
