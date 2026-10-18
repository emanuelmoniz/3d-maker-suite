import { appendFile, cp, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

const fixtures = join(import.meta.dirname, "../../../packages/3mf/fixtures");

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let id: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slicing-"));
  await mkdir(join(dir, "data"));
  await mkdir(join(dir, "models", "Benchy"), { recursive: true });
  file = join(dir, "models", "Benchy", "benchy.3mf");
  await cp(join(fixtures, "multi_color.3mf"), file);
  app = await buildApp(openDb(":memory:"), false, join(dir, "data"));
  await app.inject({
    method: "PATCH",
    url: "/api/preferences",
    payload: { projectRoots: [join(dir, "models")] },
  });
  id = (
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Benchy", folderPath: join(dir, "models", "Benchy") },
    })
  ).json().id;
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const put = (plates: unknown[]) =>
  app.inject({ method: "PUT", url: `/api/projects/${id}/slicing`, payload: { plates } });
const states = async () =>
  (await app.inject(`/api/projects/${id}/slicing`))
    .json()
    .plates.map((p: { state: string }) => p.state);

describe("project slicing setup", () => {
  it("saves and reloads, and tells a changed or missing file", async () => {
    expect((await app.inject(`/api/projects/${id}/slicing`)).json()).toEqual({ plates: [] });
    const profile = (
      await app.inject({ method: "POST", url: "/api/print-profiles", payload: { name: "0.20mm" } })
    ).json();
    const plate = { file: "benchy.3mf", plate: 1, printProfileId: profile.id, filaments: [null] };
    expect((await put([plate])).statusCode).toBe(200);
    expect((await app.inject(`/api/projects/${id}/slicing`)).json()).toEqual({
      plates: [{ ...plate, state: "ok" }],
    });

    // Touched but the same bytes: still ok. Changed bytes: outdated. Gone: missing.
    const later = new Date(Date.now() + 60_000);
    await utimes(file, later, later);
    expect(await states()).toEqual(["ok"]);
    await appendFile(file, "x");
    expect(await states()).toEqual(["outdated"]);
    await rm(file);
    expect(await states()).toEqual(["missing"]);

    // A deleted print profile falls back to the default.
    await app.inject({ method: "DELETE", url: `/api/print-profiles/${profile.id}` });
    expect((await app.inject(`/api/projects/${id}/slicing`)).json().plates[0].printProfileId).toBe(
      null,
    );
  });

  it("refuses plates, files and profiles the project doesn't have", async () => {
    const ok = { file: "benchy.3mf", plate: 1, printProfileId: null, filaments: [] };
    expect((await put([{ ...ok, plate: 99 }])).statusCode).toBe(400);
    expect((await put([{ ...ok, file: "../other.3mf" }])).statusCode).toBe(400);
    expect((await put([{ ...ok, printProfileId: crypto.randomUUID() }])).statusCode).toBe(400);
    expect((await put([{ ...ok, filaments: [crypto.randomUUID()] }])).statusCode).toBe(400);
    expect((await put([ok, ok])).statusCode).toBe(400);
    expect((await put([ok])).statusCode).toBe(200);
    expect((await put([])).json()).toEqual({ plates: [] });
  });
});
