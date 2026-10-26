import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import type { IntegrationAdapter, Release } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { createSlicerInstaller } from "./integrations/managedSlicer.ts";
import { can } from "./lib/auth.ts";

const adapter: IntegrationAdapter = {
  id: "srv",
  kind: "server",
  capabilities: ["slice"],
  library: { id: "srv", defaultDirs: () => [], read: async () => [] },
  slicer: { slice: async () => ({ printTimeSeconds: 1, weightGrams: 1, filaments: [] }) },
  managed: {
    repo: "vendor/slicer",
    licenceUrl: "https://licence",
    asset: (_tag, names) => names.find((n) => n.endsWith(".zip")),
    exe: () => "bin/slicer.exe",
    profiles: () => "resources/profiles",
  },
  configSchema: z.object({}),
  secretsSchema: z.object({}),
};

const zipOf = async (version: string) => {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(version), "bin/slicer.exe");
  zip.addBuffer(Buffer.from("{}"), "resources/profiles/BBL.json");
  zip.addBuffer(Buffer.from("x"), "bin/slicer.pdb");
  zip.end();
  return buffer(zip.outputStream);
};

let dir: string;
let db: ReturnType<typeof openDb>;
let files: Record<string, Buffer>;
let releases: Release[];
let smokeFails = false;
let hold: Promise<void> | undefined;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "managed-"));
  db = openDb(":memory:");
  smokeFails = false;
  hold = undefined;
  files = { "v1.0.0": await zipOf("1.0.0"), "v1.1.0": await zipOf("1.1.0") };
  const rel = (
    tag: string,
    digest = createHash("sha256")
      .update(files[tag] as Buffer)
      .digest("hex"),
  ) => ({
    tag,
    prerelease: false,
    url: `https://gh/${tag}`,
    assets: [
      {
        name: `slicer-${tag}.zip`,
        size: (files[tag] as Buffer).length,
        digest: `sha256:${digest}`,
        url: tag,
      },
    ],
  });
  releases = [rel("v1.0.0"), rel("v1.1.0")];
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const start = () =>
  buildApp(db, false, dir, {
    adapters: [adapter],
    slicerInstaller: {
      releases: async () => releases,
      download: (async (url: string) => {
        await hold;
        const f = files[url];
        return new Response(f ? new Uint8Array(f) : null, { status: f ? 200 : 404 });
      }) as typeof fetch,
      smoke: async (exe) => {
        if (!existsSync(exe)) throw new Error(`no ${exe}`);
        if (smokeFails) throw new Error("exit -1");
      },
      system: { platform: "win32", arch: "x64" },
    },
  });

type App = Awaited<ReturnType<typeof start>>;
const send = (
  app: App,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) => app.inject({ method, url, payload });

async function setup() {
  const app = await start();
  const { id } = (await send(app, "POST", "/api/integrations", { adapterId: "srv" })).json();
  return { app, id: id as string, base: `/api/integrations/${id}` };
}

/** Starts an install and waits for the job to end. */
async function install(app: App, base: string, tag: string) {
  const res = await send(app, "POST", `${base}/slicer/install`, { tag });
  expect(res.statusCode).toBe(202);
  for (let i = 0; i < 200; i++) {
    const s = (await send(app, "GET", `${base}/slicer/install`)).json();
    if (s.state !== "running") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("install never ended");
}

describe("managed slicer", () => {
  it("lists releases newest first and is unavailable until installed", async () => {
    const { app, base } = await setup();
    const list = (await send(app, "GET", `${base}/slicer/releases`)).json();
    expect(list.map((r: { tag: string }) => r.tag)).toEqual(["v1.1.0", "v1.0.0"]);
    expect(list[0].size).toBe((files["v1.1.0"] as Buffer).length);
    expect((await send(app, "GET", base)).json()).toMatchObject({
      kind: "server",
      status: "unavailable",
      capabilities: [],
    });
    const adapters = (await send(app, "GET", "/api/integrations/adapters")).json();
    expect(adapters[0].managed).toEqual({ repo: "vendor/slicer", licenceUrl: "https://licence" });
  });

  it("downloads, checks, unpacks without .pdb, tests, then points the integration at it", async () => {
    const { app, id, base } = await setup();
    expect(await install(app, base, "v1.0.0")).toMatchObject({
      state: "done",
      tag: "v1.0.0",
      error: null,
      received: (files["v1.0.0"] as Buffer).length,
    });
    const slicers = join(dir, "slicers", id);
    expect(readdirSync(slicers).sort()).toEqual(["1.0.0", "config"]);
    expect(existsSync(join(slicers, "1.0.0", "bin", "slicer.pdb"))).toBe(false);
    expect(readFileSync(join(slicers, "config", "system", "BBL.json"), "utf8")).toBe("{}");
    expect((await send(app, "GET", base)).json()).toMatchObject({
      status: "ok",
      slicerVersion: "1.0.0",
      slicerPath: join(slicers, "1.0.0", "bin", "slicer.exe"),
      slicerConfigDir: join(slicers, "config"),
      capabilities: ["slice"],
    });
  });

  it("an update keeps the old version until the new one passes its smoke test", async () => {
    const { app, id, base } = await setup();
    await install(app, base, "v1.0.0");
    smokeFails = true;
    expect(await install(app, base, "v1.1.0")).toMatchObject({
      state: "failed",
      error: "smoke_failed",
      detail: "exit -1",
    });
    const slicers = join(dir, "slicers", id);
    expect(readdirSync(slicers).sort()).toEqual(["1.0.0", "config"]);
    expect((await send(app, "GET", base)).json().slicerVersion).toBe("1.0.0");

    smokeFails = false;
    expect((await install(app, base, "v1.1.0")).state).toBe("done");
    expect(readdirSync(slicers).sort()).toEqual(["1.1.0", "config"]);
    expect(readFileSync(join(slicers, "config", "system", "BBL.json"), "utf8")).toBe("{}");
    expect((await send(app, "GET", base)).json().slicerVersion).toBe("1.1.0");
  });

  it("refuses a download that doesn't match its digest", async () => {
    const { app, id, base } = await setup();
    files["v1.0.0"] = Buffer.from("tampered");
    expect(await install(app, base, "v1.0.0")).toMatchObject({
      state: "failed",
      error: "bad_digest",
    });
    expect(readdirSync(join(dir, "slicers", id))).toEqual([]);
    expect((await send(app, "GET", base)).json().slicerVersion).toBeNull();
  });

  it("one install at a time; Remove waits too; unknown tags are 404", async () => {
    const { app, base } = await setup();
    let release = () => {};
    hold = new Promise((r) => {
      release = r;
    });
    expect((await send(app, "POST", `${base}/slicer/install`, { tag: "v1.0.0" })).statusCode).toBe(
      202,
    );
    expect(
      (await send(app, "POST", `${base}/slicer/install`, { tag: "v1.1.0" })).json().error.code,
    ).toBe("install_running");
    expect((await send(app, "DELETE", `${base}/slicer`)).statusCode).toBe(409);
    release();
    expect((await send(app, "POST", `${base}/slicer/install`, { tag: "v9.0.0" })).statusCode).toBe(
      409,
    );
    hold = undefined;
    for (
      let i = 0;
      i < 200 && (await send(app, "GET", `${base}/slicer/install`)).json().state === "running";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    expect((await send(app, "POST", `${base}/slicer/install`, { tag: "v9.0.0" })).statusCode).toBe(
      404,
    );
  });

  it("Remove clears it; paths can't be set by hand; deleting the integration deletes the folder", async () => {
    const { app, id, base } = await setup();
    await install(app, base, "v1.0.0");
    expect((await send(app, "PATCH", base, { slicerPath: "C:/x.exe" })).json().error.code).toBe(
      "slicer_managed",
    );
    // The user presets of an imported zip stay for the next install.
    mkdirSync(join(dir, "slicers", id, "config", "user", "default"), { recursive: true });
    expect((await send(app, "DELETE", `${base}/slicer`)).statusCode).toBe(204);
    expect(readdirSync(join(dir, "slicers", id))).toEqual(["config"]);
    expect(readdirSync(join(dir, "slicers", id, "config"))).toEqual(["user"]);
    expect((await send(app, "GET", base)).json()).toMatchObject({
      slicerVersion: null,
      slicerPath: null,
      status: "unavailable",
    });

    await install(app, base, "v1.0.0");
    expect((await send(app, "DELETE", base)).statusCode).toBe(204);
    expect(existsSync(join(dir, "slicers", id))).toBe(false);
  });

  it("the daily check alerts once per newer version; installing it resolves the alert", async () => {
    const installed: string[] = [];
    const installer = createSlicerInstaller(
      db,
      dir,
      [adapter],
      { warn: () => {} },
      {
        releases: async () => releases,
        download: (async (url: string) =>
          new Response(new Uint8Array(files[url] as Buffer))) as typeof fetch,
        smoke: async () => {},
        system: { platform: "win32", arch: "x64" },
        onInstalled: (id) => installed.push(id),
      },
    );
    const id = db.insert(schema.integrations).values({ adapterId: "srv" }).returning().get().id;
    const installTag = async (tag: string) => {
      await installer.install(id, tag);
      while (installer.status(id).state === "running") await new Promise((r) => setTimeout(r, 5));
    };
    const open = () =>
      db
        .select()
        .from(schema.alerts)
        .all()
        .filter((a) => a.kind === "slicer_update" && !a.resolvedAt);

    await installer.check();
    expect(open()).toEqual([]); // nothing installed
    await installTag("v1.0.0");
    expect(installed).toEqual([id]);
    await installer.check();
    await installer.check();
    expect(open()).toMatchObject([
      {
        module: "integrations",
        entityId: `${id}:1.1.0`,
        context: { integrationId: id, adapterId: "srv", version: "1.1.0" },
      },
    ]);
    await installTag("v1.1.0");
    expect(open()).toEqual([]);
    expect(installed).toEqual([id, id]);
  });

  it("cleans up a half install at start", async () => {
    const leftovers = join(dir, "slicers", "x");
    mkdirSync(join(leftovers, "1.2.0.partial"), { recursive: true });
    writeFileSync(join(leftovers, "download.zip"), "x");
    mkdirSync(join(leftovers, "1.1.0"));
    await start();
    expect(readdirSync(leftovers)).toEqual(["1.1.0"]);
  });

  it("is admin-only, reads included", () => {
    expect(can("editor", "/api/integrations/x/slicer/releases", "GET")).toBe(false);
    expect(can("viewer", "/api/integrations/x/slicer/install", "GET")).toBe(false);
    expect(can("viewer", "/api/integrations/x", "GET")).toBe(true);
  });
});
