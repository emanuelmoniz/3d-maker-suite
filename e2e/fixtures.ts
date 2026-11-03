import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect } from "@playwright/test";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

type App = {
  url: string;
  dataDir: string;
  /** JSON call against the running server, for arranging test data. */
  api: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
  /** Makes a project folder (README + model) under the data dir, returns its path. */
  makeProjectDir: (name: string) => string;
};

export const test = base.extend<{ app: App }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
  app: async ({}, use) => {
    const dataDir = mkdtempSync(join(tmpdir(), "3dms-e2e-"));
    // A sterile copy of real data, for `real-data.e2e.ts` (see apps/server/src/testRealDb.ts).
    if (process.env.REAL_DB)
      execFileSync(process.execPath, ["--import", "tsx", "src/testRealSetup.ts", dataDir], {
        cwd: join(import.meta.dirname, "..", "apps", "server"),
      });
    // Another worker can take the free port before our server binds it: then ours exits, and the
    // port answers with the other test's server. Only our data dir counts; else a new port.
    const start = async () => {
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      const server: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
        cwd: join(import.meta.dirname, "..", "apps", "server"),
        env: {
          ...process.env,
          APP_DATA_DIR: dataDir,
          PORT: String(port),
          HOST: "127.0.0.1",
          APP_MOCK_INTEGRATION: "1", // the cloud source of the integrations hub tests
        },
        stdio: "ignore",
      });
      let gone = false;
      server.once("exit", () => {
        gone = true;
      });
      for (let i = 0; i <= 150 && !gone; i++) {
        // Real data has users, so only the health check answers without a sign-in.
        const ours = await fetch(
          `${url}/api/${process.env.REAL_DB ? "health" : "preferences"}`,
        ).then(
          async (r) =>
            r.ok &&
            (!!process.env.REAL_DB ||
              ((await r.json()) as { dataDir: string }).dataDir === dataDir),
          () => false,
        );
        if (ours) return { url, server, exited: () => gone };
        await new Promise((r) => setTimeout(r, 200));
      }
      server.kill();
      return null;
    };
    let started = await start();
    for (let i = 0; !started && i < 3; i++) started = await start();
    if (!started) throw new Error("server did not start");
    const { url, server, exited: gone } = started;
    const api: App["api"] = async (method, path, body) => {
      const res = await fetch(url + path, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
      return (res.status === 204 ? undefined : await res.json()) as never;
    };
    const makeProjectDir = (name: string) => {
      const dir = join(dataDir, "models", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "README.md"), `# ${name}\n`);
      writeFileSync(join(dir, "model.stl"), "solid x\nendsolid x\n"); // a model file makes it a project
      return join(dataDir, "models");
    };
    await use({ url, dataDir, api, makeProjectDir });
    const exited = new Promise((r) => (gone() ? r(null) : server.once("exit", r)));
    server.kill();
    await exited; // release SQLite file handles (Windows) before removing the dir
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  },
  baseURL: async ({ app }, use) => use(app.url),
});

export { expect };
