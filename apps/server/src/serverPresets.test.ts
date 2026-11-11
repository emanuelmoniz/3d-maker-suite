import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bambuStudioAdapter, bambuStudioWorkerAdapter } from "@3d-maker-suite/adapter-bambu";
import { BUILT_IN_ROLE_IDS } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { savePreset } from "./integrations/presetLibrary.ts";
import { createServerPresets } from "./integrations/serverPresets.ts";
import { hashPassword } from "./lib/password.ts";

let close: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

it("this server's install receives the hub's user presets: closed only, a backup first", async () => {
  const db = openDb(":memory:");
  const dataDir = mkdtempSync(join(tmpdir(), "server-presets-"));
  const adapters = [bambuStudioAdapter(), bambuStudioWorkerAdapter()];
  const app = await buildApp(db, { stream: { write: () => true } }, dataDir, { adapters });
  close = async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  };
  const admin = db
    .insert(schema.users)
    .values({
      email: "a@x.io",
      displayName: "admin",
      roleId: BUILT_IN_ROLE_IDS.admin,
      passwordHash: await hashPassword("password123"),
    })
    .returning()
    .get();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: admin.email, password: "password123" },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  const send = (method: "POST" | "PATCH", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });
  await send("PATCH", "/api/preferences", { hubEnabled: true });

  // A Bambu Studio folder on this computer, signed out (`default`), with a file of its own.
  const cfg = mkdtempSync(join(dataDir, "local-"));
  const user = join(cfg, "user", "default", "filament");
  mkdirSync(user, { recursive: true });
  writeFileSync(join(user, "Mine.json"), JSON.stringify({ name: "Mine" }));
  const local = (await send("POST", "/api/integrations", { adapterId: "bambu-studio" })).json() as {
    id: string;
  };
  await send("PATCH", `/api/integrations/${local.id}`, { slicerConfigDir: cfg });
  const rowOf = () =>
    db.select().from(schema.integrations).where(eq(schema.integrations.id, local.id)).get();
  // Set in the database: a PATCH would start the app's own pass, with this computer's processes.
  db.update(schema.integrations)
    .set({ presetReceive: true })
    .where(eq(schema.integrations.id, local.id))
    .run();
  const json = JSON.stringify({ name: "Hub PLA", filament_cost: ["20"] });
  savePreset(db, dataDir, { library: "bambu-studio", kind: "filament", name: "Hub PLA", json });
  savePreset(db, dataDir, {
    library: "bambu-studio",
    kind: "filament",
    name: "Mine",
    json: JSON.stringify({ name: "Mine" }),
  });

  let running = true;
  const presets = createServerPresets(db, adapters, dataDir, () => {}, {
    processes: async () => (running ? '"bambu-studio.exe","1"\n' : '"x.exe","2"\n'),
  });
  const written = join(user, "Hub PLA.json");

  // Open: it waits; the same content needs no wait.
  await presets.pass();
  expect(rowOf()?.presetInstall).toMatchObject({
    library: "bambu-studio",
    waiting: true,
    queued: 1,
    queue: [{ kind: "filament", name: "Hub PLA" }],
    backup: null,
  });
  expect(existsSync(written)).toBe(false);

  // Closed: a backup of `user/`, then the write; its state is kept on the row.
  running = false;
  await presets.pass();
  expect(JSON.parse(readFileSync(written, "utf8"))).toEqual(JSON.parse(json));
  expect(existsSync(join(dataDir, "preset-backups", `${local.id}.zip`))).toBe(true);
  expect(rowOf()?.presetInstall).toMatchObject({ waiting: false, queued: 0 });
  expect(rowOf()?.presetInstall?.backup?.path).toBe(
    join(dataDir, "preset-backups", `${local.id}.zip`),
  );
  expect(Object.keys(rowOf()?.presetState?.installed ?? {})).toHaveLength(2);

  // The API shows the switch and the state, never what the queue keeps.
  const api = (
    await app.inject({ url: `/api/integrations/${local.id}`, headers: { cookie } })
  ).json();
  expect(api).toMatchObject({ presetReceive: true, presetInstall: { queued: 0 } });
  expect(api).not.toHaveProperty("presetState");

  // Off clears its state; only a slicer on this computer has the switch.
  expect(
    (await send("PATCH", `/api/integrations/${local.id}`, { presetReceive: false })).json(),
  ).toMatchObject({ presetReceive: false, presetInstall: null });
  const worker = db
    .insert(schema.integrations)
    .values({ adapterId: "bambu-studio-worker" })
    .returning()
    .get();
  expect(
    (await send("PATCH", `/api/integrations/${worker.id}`, { presetReceive: true })).json(),
  ).toMatchObject({ error: { code: "not_local" } });
}, 20_000);
