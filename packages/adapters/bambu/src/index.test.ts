import type { IntegrationContext, SecretStore } from "@3d-maker-suite/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bambuCloudAdapter, bambuStudioAdapter } from "./index.ts";

// Canned Bambu Cloud responses; each test queues what `fetch` answers, in order.
const json = (status: number, body: unknown, headers: [string, string][] = []) =>
  new Response(JSON.stringify(body), {
    status,
    headers: [["content-type", "application/json"], ...headers],
  });
const html = (status: number, headers: [string, string][] = []) =>
  new Response("<title>Attention Required! | Cloudflare</title>", {
    status,
    headers: [["content-type", "text/html"], ...headers],
  });

let fetchMock: ReturnType<typeof vi.fn>;
const queue = (...responses: (Response | Error)[]) => {
  for (const r of responses)
    fetchMock.mockImplementationOnce(async () => {
      if (r instanceof Error) throw r;
      return r;
    });
};
const sent = (i: number) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, body: init.body ? JSON.parse(String(init.body)) : undefined, init };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const adapter = bambuCloudAdapter();
const ctx = (region = "global") => ({
  config: adapter.configSchema.parse({ region }),
  log,
  signal: new AbortController().signal,
});
const login = (input: Parameters<NonNullable<typeof adapter.login>>[1], region?: string) =>
  adapter.login?.(ctx(region), input) ?? Promise.reject(new Error("no login"));
const instance = (token?: string, region?: string) => {
  const secrets: SecretStore = {
    get: async () => token,
    set: async () => {},
    delete: async () => {},
  };
  if (!adapter.create) throw new Error("no create");
  return adapter.create({ ...ctx(region), secrets } as IntegrationContext);
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e) => e.code,
  );

it("splits cloud and local, each declaring only what it provides", () => {
  expect([adapter.kind, adapter.capabilities, adapter.library]).toEqual([
    "cloud",
    ["printers", "prints", "spools"],
    undefined,
  ]);
  const studio = bambuStudioAdapter();
  expect([studio.kind, studio.capabilities, studio.create, studio.library?.id]).toEqual([
    "local",
    [
      "brands",
      "printerModels",
      "machineProfiles",
      "filamentBrands",
      "filamentProfiles",
      "openInSlicer",
    ],
    undefined,
    "bambu-studio",
  ]);
});

it("returns the token when no second step is needed", async () => {
  queue(json(200, { accessToken: "tok", refreshToken: "tok", loginType: "", expiresIn: 1 }));
  expect(await login({ email: "a@b.c", password: "pw" })).toEqual({ secrets: { token: "tok" } });
  expect(sent(0).body).toEqual({ account: "a@b.c", password: "pw", apiError: "" });
});

it("signs in with an emailed code", async () => {
  queue(json(200, { loginType: "verifyCode" }), json(200, {}));
  const step = await login({ email: "a@b.c", password: "pw" });
  expect(step).toMatchObject({ challenge: "email_code" });
  expect(sent(1).url).toContain("/sendemail/code");
  expect(sent(1).body).toEqual({ email: "a@b.c", type: "codeLogin" });

  queue(json(200, { accessToken: "tok" }));
  const state = (step as { state: string }).state;
  expect(await login({ code: "123456", state })).toEqual({ secrets: { token: "tok" } });
  expect(sent(2).body).toEqual({ account: "a@b.c", code: "123456" });

  queue(json(400, { code: 2, error: "Incorrect code" }));
  expect(await code(login({ code: "000000", state }))).toBe("code_invalid");
});

it("signs in with an authenticator code via the CSRF-protected website", async () => {
  queue(json(200, { loginType: "tfa", tfaKey: "k1" }));
  const step = await login({ email: "a@b.c", password: "pw" });
  expect(step).toMatchObject({ challenge: "totp" });

  queue(
    new Response(null, { status: 204, headers: [["set-cookie", "bbl_csrf_token=c1; Path=/"]] }),
    json(200, {}, [["set-cookie", "token=tok; Path=/; HttpOnly"]]),
  );
  const state = (step as { state: string }).state;
  expect(await login({ code: "123456", state })).toEqual({ secrets: { token: "tok" } });
  expect(sent(2).body).toEqual({ tfaKey: "k1", tfaCode: "123456" });
  expect((sent(2).init.headers as Record<string, string>)["x-bbl-csrf-token"]).toBe("c1");
});

it("uses .cn hosts for the China region", async () => {
  queue(json(200, { accessToken: "tok" }));
  await login({ email: "a@b.c", password: "pw" }, "china");
  expect(sent(0).url).toBe("https://api.bambulab.cn/v1/user-service/user/login");
});

it("maps failures to clear error codes", async () => {
  queue(json(400, { code: 1, error: "Incorrect password" }));
  expect(await code(login({ email: "a@b.c", password: "x" }))).toBe("login_failed");
  queue(html(403, [["cf-mitigated", "challenge"]]));
  expect(await code(login({ email: "a@b.c", password: "x" }))).toBe("blocked");
  queue(json(200, { loginType: "somethingNew" }));
  expect(await code(login({ email: "a@b.c", password: "x" }))).toBe("api_changed");

  const printers = () => instance("tok").printers?.listPrinters() ?? Promise.reject();
  queue(json(401, {}));
  expect(await code(printers())).toBe("auth_expired");
  queue(json(429, {}));
  expect(await code(printers())).toBe("rate_limited");
  queue(html(503));
  expect(await code(printers())).toBe("blocked");
  queue(json(502, {}));
  expect(await code(printers())).toBe("unreachable");
  queue(new TypeError("fetch failed"));
  expect(await code(printers())).toBe("unreachable");
  queue(json(200, { message: "success", items: [] }));
  expect(await code(printers())).toBe("api_changed");
  expect(await code(instance().test())).toBe("auth_required");
  expect(fetchMock).toHaveBeenCalledTimes(9);
});

it("lists bound printers without the LAN access code", async () => {
  const device = {
    dev_id: "01P00A000000001",
    name: "Workshop",
    online: true,
    dev_model_name: "C12",
    dev_product_name: "P1S",
    dev_access_code: "12345678",
    nozzle_diameter: "0.4",
  };
  queue(json(200, { message: "success", devices: [device, { ...device, name: "", dev_id: "X" }] }));
  expect(await instance("tok").printers?.listPrinters()).toEqual([
    {
      externalId: "01P00A000000001",
      serial: "01P00A000000001",
      name: "Workshop",
      brand: "Bambu Lab",
      model: "P1S",
      nozzleDiameterMm: 0.4,
    },
    {
      externalId: "X",
      serial: "X",
      name: "X",
      brand: "Bambu Lab",
      model: "P1S",
      nozzleDiameterMm: 0.4,
    },
  ]);
  expect((sent(0).init.headers as Record<string, string>).authorization).toBe("Bearer tok");
});

const task = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  designId: 42,
  status: 2,
  startTime: "2026-05-01T10:00:00Z",
  endTime: "2026-05-01T12:00:00Z",
  costTime: 7200,
  weight: 30,
  cover: "https://cdn.example/c.png",
  deviceId: "01P00A000000001",
  amsDetailMapping: [
    { ams: 0, filamentType: "PLA", sourceColor: "000000FF", targetColor: "FF8800FF", weight: 20 },
    { ams: 1, filamentType: "PETG", targetColor: "FFFFFFFF", weight: 10 },
  ],
  ...over,
});
const history = (q: { since?: string; cursor?: string } = {}, region?: string) =>
  instance("tok", region).printHistory?.listPrints(q);

it("maps finished tasks with filament per slot, link and cover", async () => {
  queue(json(200, { total: 1, hits: [task(7)] }));
  const page = await history();
  expect(page).toEqual({
    items: [
      {
        externalId: "7",
        printerExternalId: "01P00A000000001",
        title: "Task 7",
        startedAt: "2026-05-01T10:00:00.000Z",
        durationSec: 7200,
        outcome: "success",
        filaments: [
          { slot: 0, material: "PLA", colorHex: "#FF8800", grams: 20 },
          { slot: 1, material: "PETG", colorHex: "#FFFFFF", grams: 10 },
        ],
        coverUrl: "https://cdn.example/c.png",
        sourceUrl: "https://makerworld.com/models/42",
      },
    ],
    nextCursor: undefined,
  });
  expect(sent(0).url).toBe("https://api.bambulab.com/v1/user-service/my/tasks?limit=100&offset=0");
});

it("keeps the plate number when the cloud sends a usable one", async () => {
  queue(json(200, { hits: [task(1, { plateIndex: 3 }), task(2, { plateIndex: 0 }), task(3)] }));
  expect((await history())?.items.map((p) => p.plate)).toEqual([3, undefined, undefined]);
});

it("scales a failed print by how far it got and skips unfinished tasks", async () => {
  queue(
    json(200, {
      hits: [
        task(8, { status: 3, endTime: "2026-05-01T11:00:00Z" }),
        task(9, { status: 4 }), // printing now
        task(10, { amsDetailMapping: [] }),
      ],
    }),
  );
  const items = (await history(undefined, "china"))?.items ?? [];
  expect(items.map((p) => p.externalId)).toEqual(["8", "10"]);
  expect(items[0]).toMatchObject({
    outcome: "failed",
    sourceUrl: "https://makerworld.com.cn/models/42",
  });
  expect(items[0]?.filaments.map((f) => f.grams)).toEqual([10, 5]);
  expect(items[1]?.filaments).toEqual([{ grams: 30 }]); // no AMS detail: weight only, no colour
});

it("pages by offset until the window or the total is covered", async () => {
  const full = Array.from({ length: 100 }, (_, i) => task(1000 - i));
  queue(json(200, { total: 182, hits: full }));
  expect((await history({ since: "2026-04-01T00:00:00.000Z" }))?.nextCursor).toBe("100");
  expect(sent(0).url).toContain("offset=0");
  // The last task is older than the window: nothing further back is needed.
  queue(json(200, { total: 182, hits: full }));
  expect((await history({ since: "2026-06-01T00:00:00.000Z" }))?.nextCursor).toBeUndefined();
  // The second page reaches the total. `after` is never sent: the API ignores it.
  queue(json(200, { total: 182, hits: full.slice(0, 82) }));
  expect((await history({ cursor: "100" }))?.nextCursor).toBeUndefined();
  expect(sent(2).url).toContain("offset=100");
  expect(sent(2).url).not.toContain("after=");
  // Without a total, a short page is the last one.
  queue(json(200, { hits: full }), json(200, { hits: full.slice(0, 5) }));
  expect((await history())?.nextCursor).toBe("100");
  expect((await history({ cursor: "100" }))?.nextCursor).toBeUndefined();
});

it("reports an unexpected task shape as api_changed and a missing token as auth_required", async () => {
  queue(json(200, { hits: [{ id: 1 }] }));
  expect(await code(history() ?? Promise.resolve())).toBe("api_changed");
  expect(await code(instance().printHistory?.listPrints({}) ?? Promise.resolve())).toBe(
    "auth_required",
  );
});

it("lists the cloud filament manager's spools, page by page", async () => {
  const hit = (id: number, extra = {}) => ({
    id,
    filamentVendor: "Bambu Lab",
    filamentType: "PLA",
    filamentName: "PLA Basic",
    color: "#042F56FF",
    netWeight: 931,
    totalNetWeight: 1000,
    status: 0,
    ...extra,
  });
  const page1 = Array.from({ length: 100 }, (_, i) => hit(i + 1));
  queue(
    json(200, { hits: page1 }),
    json(200, {
      total: 102,
      hits: [hit(101, { netWeight: null, color: null }), hit(102, { filamentType: "" })],
    }),
  );
  const spools = (await instance("tok").spools?.listSpools()) ?? [];
  expect(sent(0).url).toContain("/v1/design-user-service/my/filament/v2?offset=0&limit=100");
  expect(sent(1).url).toContain("offset=100");
  expect(spools).toHaveLength(101); // no material: skipped
  expect(spools[0]).toEqual({
    spoolId: "1",
    profile: { brand: "Bambu Lab", material: "PLA", name: "PLA Basic" },
    colorHex: "#042f56",
    initialGrams: 1000,
    remainingGrams: 931,
    emptyWeightGrams: null,
    status: "in_use",
  });
  expect(spools[100]).toMatchObject({ colorHex: "#808080", remainingGrams: 0, status: "empty" });
});
