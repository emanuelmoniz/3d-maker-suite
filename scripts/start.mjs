// `pnpm start`: builds the web app, runs the server and starts it again when it exits with
// RESTART, applying a pending update or rollback in between (ADR-0009). No supervisor needed.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPending, RESTART, sh } from "./update.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// What Settings -> Start at login registers. Git installs keep a console window open (docs/install.md).
const launchCmd =
  process.platform === "win32"
    ? `cmd.exe /c "cd /d "${root}" && pnpm start"`
    : `cd "${root}" && pnpm start`;

// Ctrl+C reaches the server too (same terminal); this waits for it to exit instead of dying first.
process.on("SIGINT", () => {});
let server;
process.on("SIGTERM", () => server?.kill("SIGTERM"));

sh(root, "pnpm", ["--filter", "@3d-maker-suite/web", "build"]);
for (;;) {
  const code = await new Promise((resolve) => {
    server = spawn(process.execPath, ["--import", "tsx", "src/main.ts", ...process.argv.slice(2)], {
      cwd: join(root, "apps", "server"),
      stdio: "inherit",
      env: { ...process.env, APP_LAUNCHER: "1", APP_LAUNCH_CMD: launchCmd },
    });
    server.on("exit", (c) => resolve(c ?? 0));
  });
  if (code !== RESTART) process.exit(code);
  try {
    applyPending(root);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
