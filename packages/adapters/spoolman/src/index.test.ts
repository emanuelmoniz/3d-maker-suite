import { readFileSync } from "node:fs";
import type { IntegrationInstance, SpoolUsageTarget } from "@3d-maker-suite/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeSpoolman, fakeSpoolman } from "./fake.ts";
import { baseUrl, FIELD, markerOf, spoolmanAdapter } from "./index.ts";
import { KEEP_KEYS, withCharge } from "./map.ts";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
let spoolman: FakeSpoolman;

beforeEach(() => {
  spoolman = fakeSpoolman();
  vi.stubGlobal("fetch", vi.fn(spoolman.handle));
});
afterEach(() => vi.unstubAllGlobals());

function instance(): IntegrationInstance {
  const adapter = spoolmanAdapter();
  const create = adapter.create;
  if (!create) throw new Error("no create");
  return create({
    config: adapter.configSchema.parse({ host: "spoolman.local:7912" }),
    secrets: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    log: silent,
    signal: new AbortController().signal,
  });
}
const usage = (): SpoolUsageTarget => {
  const u = instance().spoolUsage;
  if (!u) throw new Error("no spoolUsage");
  return u;
};
const used = (id: number) => spoolman.spools.find((s) => s.id === id)?.used_weight;
const first = () => {
  const s = spoolman.spools[0];
  if (!s) throw new Error("no spool");
  return s;
};

it("adds http:// and the API's path", () => {
  expect(baseUrl("192.168.1.60:7912")).toBe("http://192.168.1.60:7912/api/v1");
  expect(baseUrl("https://spools.example/")).toBe("https://spools.example/api/v1");
});

it("tests the connection", async () => {
  expect(await instance().test()).toEqual({ ok: true });
  spoolman.state.down = true;
  expect(await instance().test()).toEqual({ ok: false, code: "unreachable" });
});

it("imports a real Spoolman spool as brand, material, name and colour", async () => {
  const list = JSON.parse(
    readFileSync(new URL("../fixtures/spool-list.json", import.meta.url), "utf8"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(list)),
  );
  expect(await instance().spools?.listSpools()).toEqual([
    {
      spoolId: "3",
      filament: { brand: "Spike", material: "PLA", name: "PLA Spike" },
      colorHex: "#29b2b2",
      colorName: null,
      initialGrams: 1000,
      remainingGrams: 999.7,
      emptyWeightGrams: null,
      status: "in_use",
    },
  ]);
});

it("leaves archived spools out of the import", async () => {
  spoolman.addSpool({ vendor: "Bambu Lab" });
  spoolman.addSpool({ archived: true });
  expect(await instance().spools?.listSpools()).toHaveLength(1);
});

describe("writeUsage", () => {
  it("charges once, with its marker in the same request", async () => {
    const { id } = spoolman.addSpool({ used: 100 });
    first().extra = {};
    await usage().writeUsage({ spoolId: String(id), key: "p1:0", grams: 12.5, sent: 0 });
    expect(used(id)).toBe(112.5);
    const patches = spoolman.writes().filter((w) => w.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toMatchObject({ used_weight: 112.5 });
    expect(markerOf(first()).charges).toEqual({ "p1:0": 12.5 });
    // The field was made once, as text.
    expect(spoolman.fields).toEqual([{ key: FIELD, name: "3D Maker Suite", field_type: "text" }]);
    // Again: already there, nothing written.
    await usage().writeUsage({ spoolId: String(id), key: "p1:0", grams: 12.5, sent: 0 });
    expect(used(id)).toBe(112.5);
    expect(spoolman.writes().filter((w) => w.method === "PATCH")).toHaveLength(1);
  });

  it("never charges twice when the answer was lost", async () => {
    const { id } = spoolman.addSpool();
    const u = usage();
    await u.writeUsage({ spoolId: String(id), key: "p1:0", grams: 5, sent: 0 }); // makes the field
    spoolman.state.loseAnswers = 1;
    await expect(
      u.writeUsage({ spoolId: String(id), key: "p2:0", grams: 10, sent: 0 }),
    ).rejects.toMatchObject({ code: "unreachable" });
    // Spoolman took it; the server doesn't know, so it sends the same again.
    expect(used(id)).toBe(15);
    await usage().writeUsage({ spoolId: String(id), key: "p2:0", grams: 10, sent: 0 });
    expect(used(id)).toBe(15);
  });

  it("sends an edit as the difference and a delete as a refund", async () => {
    const { id } = spoolman.addSpool({ used: 50 });
    const u = usage();
    await u.writeUsage({ spoolId: String(id), key: "p1:0", grams: 10, sent: 0 });
    await u.writeUsage({ spoolId: String(id), key: "p1:0", grams: 14, sent: 10 });
    expect(used(id)).toBe(64);
    await u.writeUsage({ spoolId: String(id), key: "p1:0", grams: 0, sent: 14 });
    expect(used(id)).toBe(50);
    // Never below nothing.
    await u.writeUsage({ spoolId: String(id), key: "p9:0", grams: 0, sent: 80 });
    expect(used(id)).toBe(0);
  });

  it("trusts what the server sent for a key the marker doesn't keep", async () => {
    const { id } = spoolman.addSpool({ used: 30 });
    // A print from before the link (or one pruned from the marker) held 10 g.
    await usage().writeUsage({ spoolId: String(id), key: "p1:0", grams: 12, sent: 10 });
    expect(used(id)).toBe(32);
    await usage().writeUsage({ spoolId: String(id), key: "p0:0", grams: 7, sent: 7 });
    expect(used(id)).toBe(32);
  });

  it("keeps the other extra fields", async () => {
    const { id } = spoolman.addSpool();
    spoolman.fields.push({ key: "shelf", name: "Shelf", field_type: "text" });
    first().extra = { shelf: JSON.stringify("B2") };
    await usage().writeUsage({ spoolId: String(id), key: "p1:0", grams: 1, sent: 0 });
    expect(spoolman.spools[0]?.extra.shelf).toBe(JSON.stringify("B2"));
  });

  it("says when the spool is gone", async () => {
    expect(await usage().writeUsage({ spoolId: "99", key: "p1:0", grams: 1, sent: 0 })).toEqual({
      gone: true,
    });
  });

  it("keeps the newest keys only", () => {
    let m = { charges: {} as Record<string, number> };
    for (let i = 0; i <= KEEP_KEYS; i++) m = withCharge(m, `p${i}:0`, i);
    expect(Object.keys(m.charges)).toHaveLength(KEEP_KEYS);
    expect(m.charges["p0:0"]).toBeUndefined();
    // Written again: it moves to the end.
    m = withCharge(m, "p1:0", 9);
    expect(Object.keys(m.charges).at(-1)).toBe("p1:0");
  });
});

describe("createSpool", () => {
  const app = {
    appSpoolId: "app-1",
    brand: "Bambu Lab",
    material: "PLA",
    name: "PLA Basic",
    colorHex: "#29B2B2",
    colorName: "Cyan",
    densityGcm3: 1.26,
    initialGrams: 1000,
    remainingGrams: 760,
    emptyWeightGrams: 250,
  };

  it("finds the filament by brand, material, name and colour", async () => {
    const own = spoolman.addSpool({ vendor: "Bambu Lab", name: "PLA Basic", colorHex: "29b2b2" });
    const { spoolId } = await usage().createSpool(app);
    const made = spoolman.spools.find((s) => String(s.id) === spoolId);
    expect(made?.filament.id).toBe(own.filament.id);
    expect(made).toMatchObject({ initial_weight: 1000, spool_weight: 250, used_weight: 240 });
    expect(made && markerOf(made)).toEqual({ charges: {}, spool: "app-1" });
    expect(spoolman.vendors).toHaveLength(1);
    expect(spoolman.filaments).toHaveLength(1);
  });

  it("makes the vendor and filament it doesn't have", async () => {
    await usage().createSpool({ ...app, name: null });
    expect(spoolman.vendors.map((v) => v.name)).toEqual(["Bambu Lab"]);
    expect(spoolman.filaments[0]).toMatchObject({
      name: "Cyan",
      material: "PLA",
      density: 1.26,
      diameter: 1.75,
      color_hex: "29b2b2",
    });
  });

  it("finds the spool it made before when the answer was lost", async () => {
    const u = usage();
    await u.createSpool(app); // field, vendor and filament exist now
    spoolman.spools.length = 0;
    spoolman.state.loseAnswers = 1;
    await expect(u.createSpool(app)).rejects.toMatchObject({ code: "unreachable" });
    expect(spoolman.spools).toHaveLength(1);
    const again = await usage().createSpool(app);
    expect(spoolman.spools).toHaveLength(1);
    expect(again.spoolId).toBe(String(spoolman.spools[0]?.id));
  });
});
