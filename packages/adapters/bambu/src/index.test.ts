import type { IntegrationContext, SecretStore } from "@3d-maker-suite/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bambuCloudAdapter } from "./index.ts";

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
const instance = (token?: string) => {
  const secrets: SecretStore = {
    get: async () => token,
    set: async () => {},
    delete: async () => {},
  };
  return adapter.create({ ...ctx(), secrets } as IntegrationContext);
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e) => e.code,
  );

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
