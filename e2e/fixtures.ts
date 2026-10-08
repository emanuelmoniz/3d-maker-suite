import { type ChildProcess, spawn } from "node:child_process";
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
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const server: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: join(import.meta.dirname, "..", "apps", "server"),
      env: { ...process.env, APP_DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1" },
      stdio: "ignore",
    });
    for (let i = 0; ; i++) {
      if (
        await fetch(`${url}/api/preferences`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      if (i > 150) throw new Error("server did not start");
      await new Promise((r) => setTimeout(r, 200));
    }
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
    const exited = new Promise((r) => server.once("exit", r));
    server.kill();
    await exited; // release SQLite file handles (Windows) before removing the dir
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  },
  baseURL: async ({ app }, use) => use(app.url),
});

export { expect };
