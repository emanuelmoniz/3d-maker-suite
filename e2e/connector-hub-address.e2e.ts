// A real connector (apps/connector, from source) paired with the test's hub through another address,
// which then goes away: the hub "moved". Change hub address on the connector's own page brings it
// back without pairing again (6.3.0 Step 7b).
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tcpProxy } from "../apps/connector/src/testProxy.ts";
import { testTimeout } from "../test-timeout.ts";
import { expect, test } from "./fixtures.ts";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

/**
 * The connector on a free port, in a folder of its own. Its home and app-data folders are in there
 * too, with a hub `config.json` naming the connector's own port: so it never finds a hub running on
 * this PC (one hub per machine) and never touches the real sync folder.
 */
async function startConnector(args: string[]) {
  const root = mkdtempSync(join(tmpdir(), "3dms-connector-"));
  const port = await freePort();
  const env = {
    ...process.env,
    APP_DATA_DIR: join(root, "data"),
    APPDATA: join(root, "appdata"),
    XDG_DATA_HOME: join(root, "xdg"),
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
  };
  mkdirSync(env.APP_DATA_DIR, { recursive: true });
  writeFileSync(join(env.APP_DATA_DIR, "config.json"), JSON.stringify({ port }));
  for (const hubDir of [
    join(env.APPDATA, "3d-maker-suite"),
    join(env.XDG_DATA_HOME, "3d-maker-suite"),
    join(env.HOME, "Library", "Application Support", "3d-maker-suite"),
  ]) {
    mkdirSync(hubDir, { recursive: true });
    writeFileSync(join(hubDir, "config.json"), JSON.stringify({ port }));
  }
  const proc: ChildProcess = spawn(process.execPath, ["src/main.ts", ...args], {
    cwd: join(import.meta.dirname, "..", "apps", "connector"),
    env,
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  await expect
    .poll(
      () =>
        fetch(`${url}/api/health`).then(
          (r) => r.ok,
          () => false,
        ),
      {
        timeout: testTimeout(30_000, 0),
      },
    )
    .toBe(true);
  return {
    url,
    stop: async () => {
      const exited = new Promise((r) => (proc.exitCode !== null ? r(null) : proc.once("exit", r)));
      proc.kill();
      await exited;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("connector: the hub moved, Change hub address keeps the pairing", async ({ page, app }) => {
  test.setTimeout(testTimeout(90_000, 0));
  const post = async (path: string, data: object) =>
    (await page.request.post(path, { data })).json();
  const ana = await post("/api/auth/setup", {
    displayName: "Ana Admin",
    email: "ana@example.com",
    password: "correct horse",
  });
  await page.request.patch("/api/preferences", { data: { hubEnabled: true } });
  const { code } = await post("/api/hub/pairing-codes", { userId: ana.user?.id ?? ana.id });

  // Paired at an address that is about to go away.
  const old = await tcpProxy(app.url);
  const connector = await startConnector(["--hub-url", old.url, "--pairing-code", code]);
  try {
    type Device = { id: string; online: boolean; hubUrl: string | null };
    const device = async () =>
      ((await (await page.request.get("/api/hub/devices")).json()) as Device[])[0];
    await expect
      .poll(async () => (await device())?.hubUrl, { timeout: testTimeout(30_000, 0) })
      .toBe(old.url);
    const { id } = await device();

    await old.close(); // the hub "moved"
    await page.goto(`${connector.url}/local`);
    // The page reloads itself every 5 s.
    await expect(page.getByText("Offline, retrying")).toBeVisible({
      timeout: testTimeout(30_000, 0),
    });

    await page.getByRole("link", { name: "Change hub address" }).click();
    await expect(page.getByRole("heading", { name: "Change hub address" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Hub address" })).toHaveValue(old.url);
    await page.getByRole("textbox", { name: "Hub address" }).fill(app.url);
    await page.getByRole("button", { name: "Change address" }).click();
    await expect(page).toHaveURL(`${connector.url}/local`);
    await expect(page.getByText("Online", { exact: true })).toBeVisible({
      timeout: testTimeout(30_000, 0),
    });
    await expect(page.getByRole("link", { name: app.url })).toBeVisible();

    // The machine page says which address it uses now; it is still the same device.
    await page.goto(`${app.url}/hub/devices/${id}`);
    await expect(page.getByRole("region", { name: "Connection" })).toContainText(
      `Reaches the hub at ${app.url}`,
    );
    expect(await (await page.request.get("/api/hub/devices")).json()).toHaveLength(1);
  } finally {
    await connector.stop();
    await old.close();
  }
});
