import { appendFile, cp, mkdir, mkdtemp, readFile, rm, utimes } from "node:fs/promises";
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
      {
        ...plate,
        printerId: null, // no printers yet
        useDefaultPrintProfile: false,
        spools: [],
        state: "ok",
        result: null,
        error: null,
        needsSlicing: true,
        job: null,
      },
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

  it("slices for the plate's printer: the file's own settings, its default, or another model", async () => {
    const post = async (url: string, payload: object) =>
      (await app.inject({ method: "POST", url, payload })).json();
    const brand = await post("/api/brands", { name: "Bambu Lab" });
    // The fixture was saved for a "Bambu Lab A1" with a 0.4 mm nozzle.
    const a1 = await post("/api/printer-models", { brandId: brand.id, model: "A1" });
    const p1s = await post("/api/printer-models", { brandId: brand.id, model: "P1S" });
    const std = await post("/api/print-profiles", {
      name: "0.20 A1",
      sourcePreset: "mock:system/0.20 A1",
    });
    const x1c = await post("/api/print-profiles", {
      name: "0.20 X1C",
      sourcePreset: "mock:system/0.20 X1C",
    });
    const mine = await post("/api/printers", {
      name: "Mine",
      modelId: a1.id,
      state: "working",
      printProfileId: std.id,
    });
    const other = await post("/api/printers", {
      name: "Other",
      modelId: p1s.id,
      state: "working",
      printProfileId: x1c.id,
    });
    const plate = { file: "benchy.3mf", plate: 1, printProfileId: null, filaments: [] };
    const last = () => mock.sliced?.at(-1);

    // No printer given: the one that fits the file. No profile: the file's own settings.
    await put([plate]);
    expect((await settled()).plates[0]).toMatchObject({ printerId: mine.id, needsSlicing: true });
    await run();
    await settled();
    expect(last()?.process).toBeUndefined();
    expect(last()?.machine).toBeUndefined();

    // The printer's default profile.
    await put([{ ...plate, printerId: mine.id, useDefaultPrintProfile: true }]);
    await run();
    await settled();
    expect(last()).toMatchObject({ process: "system/0.20 A1" });

    // Another model: its default profile, always, and its machine preset, which is missing yet.
    await put([{ ...plate, printerId: other.id }]);
    let s = await settled();
    expect(s.plates[0]).toMatchObject({ useDefaultPrintProfile: true, result: null });
    await run();
    s = await settled();
    expect(s.plates[0].error).toBe("no_machine_preset: Other");
    await post("/api/machine-profiles", {
      name: "Bambu Lab P1S 0.4 nozzle",
      printerModelId: p1s.id,
      sourcePreset: "mock:system/Bambu Lab P1S 0.4 nozzle",
    });
    await run();
    s = await settled();
    expect(s.plates[0]).toMatchObject({ error: null, needsSlicing: false });
    expect(last()).toMatchObject({
      machine: "system/Bambu Lab P1S 0.4 nozzle",
      process: "system/0.20 X1C",
    });
    expect(await listSlicing("?slicing=done")).toHaveLength(1);

    // Back to the first printer: a different slice, so the result is gone.
    await put([{ ...plate, printerId: mine.id }]);
    expect((await settled()).plates[0]).toMatchObject({ result: null, needsSlicing: true });
  });

  it("takes a spool's profile for its slot and keeps the slice when the spool changes", async () => {
    const post = async (url: string, payload: object) =>
      (await app.inject({ method: "POST", url, payload })).json();
    const brand = await post("/api/filament-brands", { name: "Acme" });
    const material = await post("/api/filament-materials", { name: "PLA" });
    const profile = await post("/api/filament/profiles", {
      brandId: brand.id,
      materialId: material.id,
      densityGcm3: 1.24,
      name: "Basic",
    });
    const spool = (colorHex: string) =>
      post("/api/filament/spools", { profileId: profile.id, colorHex, initialGrams: 1000 });
    const red = await spool("#ff0000");
    const blue = await spool("#0000ff");
    const plate = { file: "benchy.3mf", plate: 1, printProfileId: null, filaments: [] };

    expect((await put([{ ...plate, spools: [crypto.randomUUID()] }])).statusCode).toBe(400);
    const saved = (await put([{ ...plate, spools: [red.id] }])).json();
    expect(saved.plates[0]).toMatchObject({ spools: [red.id], filaments: [profile.id] });
    await run();
    await settled();
    // Same profile, another spool: only the price changes, so no new slice.
    await put([{ ...plate, spools: [blue.id] }]);
    expect((await settled()).plates[0]).toMatchObject({ needsSlicing: false, spools: [blue.id] });
  });

  it("slices a quote's plates: a project's with another profile and an uploaded 3MF", async () => {
    const upload = (name: string, body: Buffer | string) =>
      app.inject({
        method: "POST",
        url: `/api/costs/files?name=${encodeURIComponent(name)}`,
        headers: { "content-type": "application/octet-stream" },
        payload: body,
      });
    const bytes = await readFile(join(fixtures, "single_color.3mf"));
    expect((await upload("model.stl", bytes)).statusCode).toBe(400);
    expect((await upload("broken.3mf", "not a zip")).statusCode).toBe(400);
    const up = await upload("Vase.3mf", bytes);
    expect(up.statusCode).toBe(201);
    const { id: fileId, model } = up.json();
    expect(model.file).toBe(`upload:${fileId}`);
    expect(model.plates.length).toBeGreaterThan(0);
    // The same bytes again: the same file.
    expect((await upload("Copy.3mf", bytes)).json().id).toBe(fileId);

    const preset = (
      await app.inject({
        method: "POST",
        url: "/api/print-profiles",
        payload: { name: "Fine", sourcePreset: "mock:system/Fine" },
      })
    ).json();
    const plates = [
      { file: "benchy.3mf", plate: 1, printProfileId: preset.id, filaments: [] },
      { file: model.file, plate: 1, printProfileId: null, filaments: [] },
    ];
    const slice = async (run: boolean, body: object = { projectId: id, plates }) =>
      app.inject({ method: "POST", url: "/api/costs/slice", payload: { ...body, run } });

    // Reporting only: nothing sliced yet, nothing queued.
    expect((await slice(false)).json().plates).toMatchObject([
      { job: null, result: null },
      { job: null, result: null },
    ]);
    await slice(true);
    let s = (await slice(false)).json();
    for (let i = 0; i < 200 && s.plates.some((p: { job: unknown }) => p.job); i++) {
      await new Promise((r) => setTimeout(r, 10));
      s = (await slice(false)).json();
    }
    expect(s.canSlice).toBe(true);
    expect(s.plates[0]).toMatchObject({ error: null, result: { printTimeSeconds: 5400 } });
    expect(s.plates[1]).toMatchObject({ error: null, result: { printTimeSeconds: 3600 } });
    expect(mock.sliced?.[0]).toMatchObject({ process: "system/Fine" });
    // Asked again: the same result, no new slice. The project's own setup is untouched.
    await slice(true);
    expect(mock.sliced).toHaveLength(2);
    expect((await app.inject(`/api/projects/${id}/slicing`)).json().plates).toEqual([]);

    // Without a project only uploads; nothing outside them is read.
    expect((await slice(false, { projectId: null, plates: [plates[1]] })).statusCode).toBe(200);
    expect((await slice(false, { projectId: null, plates: [plates[0]] })).statusCode).toBe(400);
    const bad = { ...plates[1], file: "upload:../../secret" };
    expect((await slice(false, { projectId: null, plates: [bad] })).statusCode).toBe(400);
    expect((await app.inject(`/api/costs/files/${fileId}?entry=nope.png`)).statusCode).toBe(404);
  });

  it("answers 409 without a slicer", async () => {
    const list = (await app.inject("/api/integrations")).json();
    for (const i of list) await app.inject({ method: "DELETE", url: `/api/integrations/${i.id}` });
    expect((await run()).json().error.code).toBe("no_slicer");
  });
});
