import { appendFile, cp, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

const fixtures = join(import.meta.dirname, "../../../packages/3mf/fixtures");

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let id: string;
let file: string;
let mock: MockState;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slicing-"));
  await mkdir(join(dir, "data"));
  await mkdir(join(dir, "models", "Benchy"), { recursive: true });
  file = join(dir, "models", "Benchy", "benchy.3mf");
  await cp(join(fixtures, "multi_color.3mf"), file);
  mock = fixture();
  app = await buildApp(openDb(":memory:"), false, join(dir, "data"), {
    adapters: [mockAdapter(mock)],
  });
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
    expect((await app.inject(`/api/projects/${id}/slicing`)).json()).toEqual({
      plates: [],
      canSlice: false,
    });
    const profile = (
      await app.inject({ method: "POST", url: "/api/print-profiles", payload: { name: "0.20mm" } })
    ).json();
    const plate = { file: "benchy.3mf", plate: 1, printProfileId: profile.id, filaments: [null] };
    expect((await put([plate])).statusCode).toBe(200);
    expect((await app.inject(`/api/projects/${id}/slicing`)).json().plates).toEqual([
      { ...plate, state: "ok", result: null, error: null, needsSlicing: true, job: null },
    ]);

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
    expect((await put([])).json().plates).toEqual([]);
  });
});

/** Polls until no plate is queued or slicing; returns the last state. */
async function settled() {
  for (let i = 0; i < 200; i++) {
    const s = (await app.inject(`/api/projects/${id}/slicing`)).json();
    if (!s.plates.some((p: { job: unknown }) => p.job)) return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("slicing never finished");
}
const run = () => app.inject({ method: "POST", url: `/api/projects/${id}/slicing/run` });
const listSlicing = async (filter = "") =>
  (await app.inject(`/api/projects${filter}`))
    .json()
    .items.map((p: { slicing: string }) => p.slicing);

describe("slicing a project (mock slicer)", () => {
  beforeEach(async () => {
    // The mock slicer needs a program path that exists; it never runs it.
    const mockId = (
      await app.inject({
        method: "POST",
        url: "/api/integrations",
        payload: { adapterId: "mock", secrets: { token: "t" } },
      })
    ).json().id;
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${mockId}`,
      payload: { slicerPath: process.execPath },
    });
  });

  it("slices, stores the result, re-slices only what changed", async () => {
    const preset = (
      await app.inject({
        method: "POST",
        url: "/api/print-profiles",
        payload: { name: "Fine", sourcePreset: "mock:system/Fine" },
      })
    ).json();
    expect(await listSlicing()).toEqual(["none"]);
    await put([{ file: "benchy.3mf", plate: 1, printProfileId: null, filaments: [] }]);
    expect(await listSlicing()).toEqual(["needed"]);
    expect(await listSlicing("?slicing=needed")).toHaveLength(1);
    expect(await listSlicing("?slicing=done")).toHaveLength(0);

    expect((await run()).statusCode).toBe(202);
    let s = await settled();
    expect(s.canSlice).toBe(true);
    expect(s.plates[0]).toMatchObject({
      needsSlicing: false,
      error: null,
      result: { printTimeSeconds: 3600, weightGrams: 10, filaments: [{ slot: 1, grams: 10 }] },
    });
    expect(mock.sliced).toHaveLength(1);
    expect(await listSlicing("?slicing=done")).toHaveLength(1);

    // Nothing changed: nothing to slice. Saved again unchanged: the result stays.
    await run();
    await settled();
    expect(mock.sliced).toHaveLength(1);
    await put([{ file: "benchy.3mf", plate: 1, printProfileId: null, filaments: [] }]);
    expect((await settled()).plates[0].needsSlicing).toBe(false);

    // Another print profile: re-sliced with its preset.
    await put([{ file: "benchy.3mf", plate: 1, printProfileId: preset.id, filaments: [] }]);
    expect((await settled()).plates[0]).toMatchObject({ needsSlicing: true, result: null });
    await run();
    s = await settled();
    expect(mock.sliced?.at(-1)).toMatchObject({ plate: 1, process: "system/Fine" });
    expect(s.plates[0].result.printTimeSeconds).toBe(5400);

    // The file changed on disk: outdated, sliced again.
    await appendFile(file, "x");
    s = await settled();
    expect(s.plates[0]).toMatchObject({ state: "outdated", needsSlicing: true });
    await run();
    s = await settled();
    expect(s.plates[0]).toMatchObject({ state: "ok", needsSlicing: false });
    expect(mock.sliced).toHaveLength(3);
  });

  it("keeps the slicer's error on the plate, and refuses a profile that isn't its preset", async () => {
    const handMade = (
      await app.inject({ method: "POST", url: "/api/print-profiles", payload: { name: "Mine" } })
    ).json();
    await put([{ file: "benchy.3mf", plate: 1, printProfileId: handMade.id, filaments: [] }]);
    await run();
    expect((await settled()).plates[0]).toMatchObject({ error: "no_preset: Mine", result: null });
    expect(mock.sliced ?? []).toHaveLength(0);

    await put([{ file: "benchy.3mf", plate: 1, printProfileId: null, filaments: [] }]);
    mock.sliceError = "Nothing to be sliced (-50)";
    await run();
    expect((await settled()).plates[0]).toMatchObject({
      error: "slice_failed: Nothing to be sliced (-50)",
      needsSlicing: true,
    });
  });

  it("answers 409 without a slicer", async () => {
    const list = (await app.inject("/api/integrations")).json();
    for (const i of list) await app.inject({ method: "DELETE", url: `/api/integrations/${i.id}` });
    expect((await run()).json().error.code).toBe("no_slicer");
  });
});
